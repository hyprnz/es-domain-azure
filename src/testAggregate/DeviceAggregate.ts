import { Aggregate, AggregateContainer, EntityEvent, Uuid } from '@hyprnz/es-domain'
import { Alarm, Device, DeviceCreatedEvent } from './Device'

export class DeviceAggregate implements Aggregate {
  constructor(private aggregate: AggregateContainer<Device> = new AggregateContainer<Device>()) {}

  private get root(): Device {
    return this.aggregate.rootEntity
  }

  get changeVersion(): number {
    return this.aggregate.changeVersion
  }

  get id(): Uuid.UUID {
    return this.aggregate.id
  }

  markChangesAsCommitted(version: number): void {
    this.aggregate.markChangesAsCommitted(version)
  }

  uncommittedChanges(): Array<EntityEvent> {
    return this.aggregate.uncommittedChanges()
  }

  withDevice(id: Uuid.UUID): this {
    this.aggregate.rootEntity = new Device(evt => this.aggregate.observe(evt))
    this.root.applyChangeEvent(new DeviceCreatedEvent(id, id))

    return this
  }

  loadFromHistory(history: EntityEvent[]): void {
    this.aggregate.rootEntity = new Device(evt => this.aggregate.observe(evt))
    this.aggregate.loadFromHistory(history)
  }

  addAlarm(alarmId: Uuid.UUID): Alarm {
    return this.root.addAlarm(alarmId)
  }

  destroyAlarm(alarmId: Uuid.UUID): void {
    const alarm = this.root.findAlarm(alarmId)
    if (alarm) this.root.destroyAlarm(alarm)
  }

  findAlarm(alarmId: Uuid.UUID): Alarm | undefined {
    return this.root.findAlarm(alarmId)
  }
}
