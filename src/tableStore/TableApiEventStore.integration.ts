import { assertThat, match } from 'mismatched'
import { AggregateRepository, EntityEvent, Uuid } from '@hyprnz/es-domain'
import { DeviceAggregate } from '../testAggregate/DeviceAggregate'
import { TableClient } from '@azure/data-tables'
import { TableApiEventStore } from './TableApiEventStore'
import { OptimisticConcurrencyError } from '@hyprnz/es-domain/dist/src/writeModelRepository/OptimisticConcurrencyError'

describe('TableApiEventStore', () => {
  let repository: AggregateRepository  
  
  before(async () => {
    const developmentConnectionString = "UseDevelopmentStorage=true";
    const containerConnectionString = 'DefaultEndpointsProtocol=http;AccountName=dev;AccountKey=some-key;TableEndpoint=http://localhost:10002/dev;'

    const tableClient = TableClient.fromConnectionString(
      developmentConnectionString, 
      'eventstore', 
      { allowInsecureConnection: true }
    )

    
    // await tableClient.deleteTable()
    await tableClient.createTable()

    repository = new AggregateRepository(new TableApiEventStore(tableClient))
  })

  it('stores events', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()

    const deviceAggregate = new DeviceAggregate().withDevice(deviceId)
    deviceAggregate.addAlarm(alarmId)

    const uncommittedEvents = deviceAggregate.uncommittedChanges()

    const emittedEvents: Array<EntityEvent> = []
    repository.subscribeToChangesSynchronously(async changes => changes.forEach(x => emittedEvents.push(x)))

    const countEvents = await repository.save(deviceAggregate)

    assertThat(countEvents).withMessage('Stored Event count').is(2)
    assertThat(emittedEvents).withMessage('Emitted Events').is(match.array.length(2))
    assertThat(uncommittedEvents).is(emittedEvents)
  })

  it('loads events', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()

    const deviceAggregate = new DeviceAggregate().withDevice(deviceId)
    deviceAggregate.addAlarm(alarmId)

    const uncomittedEvents = deviceAggregate.uncommittedChanges()
    await repository.save(deviceAggregate)

    // Compare Saved event to loaded make sure they are the same
    const loadedEvents = await repository.loadEvents(deviceId)
    assertThat(loadedEvents).is(match.array.length(2))
    assertThat(uncomittedEvents).is(loadedEvents)
  })

  it('detects concurrency', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()

    const deviceAggregate = new DeviceAggregate().withDevice(deviceId)
    deviceAggregate.addAlarm(alarmId)
    await repository.save(deviceAggregate)

    const anotherDeviceAggregate = await repository.load(deviceId, new DeviceAggregate())

    // Make changes to both
    deviceAggregate.addAlarm(Uuid.createV4())
    anotherDeviceAggregate.addAlarm(Uuid.createV4())

    assertThat(deviceAggregate.changeVersion).withMessage('deviceAggregate version').is(1)
    assertThat(anotherDeviceAggregate.changeVersion).withMessage('anotherDeviceAggregate version').is(1)

    assertThat(deviceAggregate.uncommittedChanges()).is(match.array.length(1))
    assertThat(anotherDeviceAggregate.uncommittedChanges()).is(match.array.length(1))

    assertThat(deviceAggregate.uncommittedChanges()[0].version).withMessage('UnCommited device').is(2)
    assertThat(anotherDeviceAggregate.uncommittedChanges()[0].version).withMessage('UnCommited anotherDevice').is(2)

    assertThat(deviceAggregate.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited device').is(deviceId)
    assertThat(anotherDeviceAggregate.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited anotherDevice').is(deviceId)

    await repository.save(deviceAggregate)
    assertThat(repository.save(anotherDeviceAggregate)).catches(new OptimisticConcurrencyError(deviceId, 2))
  })
})
