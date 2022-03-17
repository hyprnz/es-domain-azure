import { assertThat, match } from 'mismatched'
import { CosmosClient, CosmosClientOptions } from '@azure/cosmos'
import { WriteModelCosmosSqlRepository } from './WriteModelCosmosSqlRepository'

import { makeMigrator } from './migrate'
import { EntityEvent, Uuid } from '@hyprnz/es-domain'
import { DeviceAggregate } from '../testAggregate/DeviceAggregate'
import { OptimisticConcurrencyError } from '@hyprnz/es-domain/dist/src/writeModelRepository/OptimisticConcurrencyError'

describe('WriteModelCosmosSqlRepository', () => {
  let writeModelRepo: WriteModelCosmosSqlRepository

  before(async () => {
    const databaseId = 'testdb'
    const containerName = 'eventstore'

    const options: CosmosClientOptions = { endpoint: 'localhost', key: 'some-key' }
    const client = new CosmosClient(options)

    const migrate = makeMigrator(client, databaseId, containerName)
    await migrate.up()

    const database = client.database(databaseId)
    const container = database.container(containerName)

    writeModelRepo = new WriteModelCosmosSqlRepository(container)
  })

  it('stores events', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()

    const deviceAggregate = new DeviceAggregate().withDevice(Uuid.createV4, deviceId)
    deviceAggregate.addAlarm(alarmId)

    const uncomittedEvents = deviceAggregate.uncommittedChanges()

    const emittedEvents: Array<EntityEvent> = []
    writeModelRepo.subscribeToChangesSynchronously(changes => changes.forEach(x => emittedEvents.push(x)))

    const countEvents = await writeModelRepo.save(deviceAggregate)

    assertThat(countEvents).withMessage('Stored Event count').is(1)
    assertThat(emittedEvents).withMessage('Emitted Events').is(match.array.length(1))
    assertThat(uncomittedEvents).is(emittedEvents)
  })

  it('loads events', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()

    const device = new DeviceAggregate().withDevice(Uuid.createV4, deviceId)

    device.addAlarm(alarmId)

    const uncomittedEvents = device.uncommittedChanges()
    await writeModelRepo.save(device)

    // Compare Saved event to loaded make sure they are thesame
    const loadedEvents = await writeModelRepo.loadEvents(deviceId)

    assertThat(loadedEvents).is(match.array.length(1))
    assertThat(uncomittedEvents).is(loadedEvents)
  })

  it('detects concurrency', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()

    const device = new DeviceAggregate().withDevice(Uuid.createV4, deviceId)
    device.addAlarm(alarmId)
    await writeModelRepo.save(device)

    const anotherDevice = await writeModelRepo.load(deviceId, new DeviceAggregate())

    // Make changes to both
    device.addAlarm(Uuid.createV4())
    anotherDevice.addAlarm(Uuid.createV4())

    assertThat(device.changeVersion).withMessage('deviceAggregate version').is(1)
    assertThat(anotherDevice.changeVersion).withMessage('anotherDeviceAggregate version').is(1)

    assertThat(device.uncommittedChanges()).is(match.array.length(1))
    assertThat(anotherDevice.uncommittedChanges()).is(match.array.length(1))

    assertThat(device.uncommittedChanges()[0].version).withMessage('UnCommited device').is(1)
    assertThat(anotherDevice.uncommittedChanges()[0].version).withMessage('UnCommited anotherDevice').is(1)

    assertThat(device.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited device').is(deviceId)
    assertThat(anotherDevice.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited anotherDevice').is(deviceId)

    await writeModelRepo.save(device)
    assertThat(writeModelRepo.save(anotherDevice)).catches(new OptimisticConcurrencyError(deviceId, 2))
  })
})
