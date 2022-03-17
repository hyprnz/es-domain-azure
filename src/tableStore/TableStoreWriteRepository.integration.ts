import { assertThat, match } from 'mismatched'

import { EntityEvent, Uuid } from '@hyprnz/es-domain'
import { DeviceAggregate } from '../testAggregate/DeviceAggregate'
import { TableStoreWriteRepository } from './TableStoreWriteRepository'
import { TableClient } from '@azure/data-tables'

describe('TableStoreWriteRepository', () => {
  let writeModelRepo: TableStoreWriteRepository

  before(async () => {
    const tableClient = TableClient.fromConnectionString(
      'DefaultEndpointsProtocol=http;AccountName=dev;AccountKey=some-key;TableEndpoint=http://localhost:10002/dev;',
      'eventstore',
      { allowInsecureConnection: true }
    )

    await tableClient.createTable()
    writeModelRepo = new TableStoreWriteRepository(tableClient)
  })

  it('stores events', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()
    const metadataId = Uuid.createV4()

    const deviceAggregate = new DeviceAggregate().withDevice(() => metadataId, deviceId)
    deviceAggregate.addAlarm(alarmId)

    const uncomittedEvents = deviceAggregate.uncommittedChanges()

    const emittedEvents: Array<EntityEvent> = []
    writeModelRepo.subscribeToChangesSynchronously(changes => changes.forEach(x => emittedEvents.push(x)))

    const countEvents = await writeModelRepo.save(deviceAggregate)

    assertThat(countEvents).withMessage('Stored Event count').is(2)
    assertThat(emittedEvents).withMessage('Emitted Events').is(match.array.length(2))
    assertThat(uncomittedEvents).is(emittedEvents)
  })

  it('loads events', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()
    const metadataId = Uuid.createV4()

    const device = new DeviceAggregate().withDevice(() => metadataId, deviceId)

    device.addAlarm(alarmId)

    const uncomittedEvents = device.uncommittedChanges()
    await writeModelRepo.save(device)

    // Compare Saved event to loaded make sure they are thesame
    const loadedEvents = await writeModelRepo.loadEvents(deviceId)

    assertThat(loadedEvents).is(match.array.length(2))
    assertThat(uncomittedEvents).is(match.array.unordered(loadedEvents))
  })

  it('detects concurrency', async () => {
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()
    const metadataId = Uuid.createV4()

    const device = new DeviceAggregate().withDevice(() => metadataId, deviceId)
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

    assertThat(device.uncommittedChanges()[0].version).withMessage('UnCommited device').is(2)
    assertThat(anotherDevice.uncommittedChanges()[0].version).withMessage('UnCommited anotherDevice').is(2)

    assertThat(device.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited device').is(deviceId)
    assertThat(anotherDevice.uncommittedChanges()[0].event.aggregateRootId).withMessage('UnCommited anotherDevice').is(deviceId)

    await writeModelRepo.save(device)
    await writeModelRepo.save(anotherDevice).then(
      () => {
        throw new Error('Expected and Optimistic concurrency error here!!')
      },
      e => assertThat(e.message).is(`Error:AggregateRoot, Optimistic concurrency error detected, Suggested solution is to retry`)
    )
  })
})
