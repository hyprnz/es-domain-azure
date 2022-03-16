import { AbstractChangeEvent, ChangeEvent, EntityBase, EntityChangedObserver, StaticEventHandler, Uuid } from '@hyprnz/es-domain'

export class DeviceCreatedEvent extends AbstractChangeEvent {
  static readonly eventType = 'Device.CreatedEvent'

  constructor(aggregateRootId: Uuid.UUID, entityId: Uuid.UUID) {
    super(DeviceCreatedEvent.eventType, aggregateRootId, entityId)
  }
}

export class AlarmCreatedEvent extends AbstractChangeEvent {
  static readonly eventType = 'Alarm.CreatedEvent'

  constructor(aggregateRootId: Uuid.UUID, alarmId: Uuid.UUID) {
    super(AlarmCreatedEvent.eventType, aggregateRootId, alarmId)
  }

  static assertIsAlarmCreatedEvent(event: ChangeEvent): asserts event is AlarmCreatedEvent {
    if (event.eventType === AlarmCreatedEvent.eventType) return

    throw new Error(`Unexpected EventType, Expected EventType: AlarmCreatedEvent, received ${typeof event}`)
  }
}

export class Alarm {
  constructor(readonly id: Uuid.UUID) {}
}

export class Device extends EntityBase {
  private alarms: Map<Uuid.UUID, Alarm> = new Map<Uuid.UUID, Alarm>()

  constructor(observer: EntityChangedObserver) {
    super(observer)
  }

  addAlarm(id: Uuid.UUID): Alarm {
    const alarm = this.alarms.get(id)
    if (alarm) return alarm
    return this.findAlarm(id)!
  }

  destroyAlarm(alarm: Alarm): void {
    const foundAlarm = this.alarms.get(alarm.id)
    if (!foundAlarm) return
  }

  findAlarm(id: Uuid.UUID): Alarm | undefined {
    return this.alarms.get(id)
  }

  toString() {
    return `Device: ${this.id}`
  }

  protected override makeEventHandler(evt: ChangeEvent): (() => void) | undefined {
    const handlers: Array<() => void> = []

    const handler: Array<StaticEventHandler<Device>> = Device.eventHandlers[evt.eventType]
    if (handler) handlers.push(() => handler.forEach(x => x.call(this, this, evt)))

    return handlers.length
      ? () => {
          handlers.forEach(x => x())
        }
      : undefined
  }

  private static readonly eventHandlers: Record<string, Array<StaticEventHandler<Device>>> = {
    [DeviceCreatedEvent.eventType]: [(device, evt) => (device.id = evt.aggregateRootId)],

    [AlarmCreatedEvent.eventType]: [
      (device, evt) => {
        const alarm = new Alarm(evt.id)
        device.alarms.set(alarm.id, alarm)
      }
    ]
  }
}
