import { assertThat, match } from 'mismatched'
import { CosmosClient, CosmosClientOptions } from '@azure/cosmos'
import { makeMigrator } from './makeMigrator'
import { AggregateContainer, AggregateRepository, EntityEvent, Uuid } from '@hyprnz/es-domain'
import { CosmosInternalEventStore } from './CosmosInternalEventStore'
import { Device } from '../../testAggregate/Device'

describe('CosmosInternalEventStore', () => {
  let repository: AggregateRepository

  before(async () => {
    const databaseId = 'testdb'
    const containerName = 'eventstore'

    const COSMOS_KEY='C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='
    const COSMOS_ENDPOINT='https://cosmosdb.local:8081/'
    // Set up DB connection and new up the repository
    const options: CosmosClientOptions = { endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY }
    const client = new CosmosClient(options)

    const migrate = makeMigrator(client, databaseId, containerName)
    await migrate.up()

    const database = client.database(databaseId)
    const container = database.container(containerName)

    repository = new AggregateRepository(new CosmosInternalEventStore(container))
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

    assertThat(deviceAggregate.uncommittedChanges()).withMessage("deviceAggregate one event").is(match.array.length(1))
    assertThat(anotherDeviceAggregate.uncommittedChanges()).withMessage("anotherDeviceAggregate one event").is(match.array.length(1))

    assertThat(deviceAggregate.uncommittedChanges()[0].version).withMessage('UnCommited device').is(2)
    assertThat(anotherDeviceAggregate.uncommittedChanges()[0].version).withMessage('UnCommited anotherDevice').is(2)

    assertThat(deviceAggregate.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited device').is(deviceId)
    assertThat(anotherDeviceAggregate.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited anotherDevice').is(deviceId)

    await repository.save(deviceAggregate)
    await repository.save(anotherDeviceAggregate).then(
      () => {
        throw new Error('Expected and Optimistic concurrency error here!!')
      },
      e => assertThat(e.message).is(`Optimistic concurrency error for aggregate root id: ${deviceId}, version: 2`)
    )
  })
})
