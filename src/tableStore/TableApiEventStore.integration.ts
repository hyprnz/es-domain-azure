import { assertThat, match } from 'mismatched'
import { AggregateContainer, AggregateRepository, EntityEvent, InternalEventStore, OptimisticConcurrencyError, Uuid } from '@hyprnz/es-domain'
import { TableClient } from '@azure/data-tables'
import { TableApiEventStore } from './TableApiEventStore'

import { Device } from '../testAggregate/Device'

describe('TableApiEventStore', () => {
  let repository: AggregateRepository
  let eventStoreRepo: InternalEventStore

  beforeAll(async () => {
    const developmentConnectionString = "UseDevelopmentStorage=true";
    const containerConnectionString = 'DefaultEndpointsProtocol=http;AccountName=dev;AccountKey=some-key;TableEndpoint=http://storage:10002/dev;'

    const tableClient = TableClient.fromConnectionString(
      developmentConnectionString,
      'eventstore',
      { allowInsecureConnection: true }
    )


    // await tableClient.deleteTable()
    await tableClient.createTable()

    eventStoreRepo = new TableApiEventStore(tableClient)
    repository = new AggregateRepository(eventStoreRepo)
  })

  it('stores events', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()

    const deviceAggregate = new AggregateContainer(Device) //.withDevice(deviceId)
    const device = deviceAggregate.createNewAggregateRoot({id:deviceId})
    device.addAlarm(alarmId)

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

    const deviceAggregate = new AggregateContainer(Device) //.withDevice(deviceId)
    const device = deviceAggregate.createNewAggregateRoot({id:deviceId})
    device.addAlarm(alarmId)

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

    const deviceAggregate = new AggregateContainer(Device)
    const device = deviceAggregate.createNewAggregateRoot({id:deviceId})
    device.addAlarm(alarmId)

    await repository.save(deviceAggregate)

    const anotherDeviceAggregate = await repository.load(
      deviceId,
      new AggregateContainer(Device)
    );
    const anotherDevice = anotherDeviceAggregate.rootEntity;

    // Make changes to both
    device.addAlarm(Uuid.createV4())
    anotherDevice.addAlarm(Uuid.createV4())

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

  it("should fail to append events from multiple aggregates", async () =>{
    const deviceAggregate1 = new AggregateContainer(Device) //.withDevice(deviceId)
    deviceAggregate1.createNewAggregateRoot({id:Uuid.createV4()})

    const deviceAggregate2 = new AggregateContainer(Device) //.withDevice(deviceId)
    deviceAggregate2.createNewAggregateRoot({id:Uuid.createV4()})

    // Events across multiple aggregate roots
    const events = deviceAggregate1.uncommittedChanges().concat(deviceAggregate2.uncommittedChanges())

    const VERSION = 0
    await eventStoreRepo.appendEvents(deviceAggregate1.id, VERSION, events).then(
      () => {throw new Error('Expected Multile PK to fail !!')},
      e => assertThat(e).is(new Error("All events must be for single AggregateRoot / Partition as azure table storage transactions cannot span multiple partitions."))
    )
  })

})
