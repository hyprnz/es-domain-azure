import { ChangeEvent, EntityBase, EntityChangedObserver, StaticEventHandler, Uuid } from '@hyprnz/es-domain'

export interface DeviceCreatedEvent extends ChangeEvent {
  eventType: 'DeviceCreatedEvent'
}

export namespace DeviceCreatedEvent {
  export const eventType = 'DeviceCreatedEvent'

  export const make = (
    idProvider: () => Uuid.UUID,
    data: {
      deviceId: Uuid.UUID
      correlationId?: Uuid.UUID
      causationId?: Uuid.UUID
    }
  ): DeviceCreatedEvent => ({
    id: idProvider(),
    correlationId: data.correlationId ?? idProvider(),
    causationId: data.causationId ?? idProvider(),
    eventType,
    aggregateRootId: data.deviceId,
    entityId: data.deviceId
  })

  export const isDeviceCreatedEvent = (e: ChangeEvent): e is DeviceCreatedEvent => e.eventType === eventType
  export function assertDeviceCreatedEvent(e: ChangeEvent): asserts e is DeviceCreatedEvent {
    if (isDeviceCreatedEvent(e)) return
    throw new Error(`Unexpected EventType, Expected EventType: DeviceCreatedEvent, received ${typeof e}`)
  }
}

export interface AlarmCreatedEvent extends ChangeEvent {
  eventType: 'AlarmCreatedEvent'
}

export namespace AlarmCreatedEvent {
  export const eventType = 'AlarmCreatedEvent'

  export const make = (
    idProvider: () => Uuid.UUID,
    data: {
      alarmId: Uuid.UUID
      deviceId: Uuid.UUID
      correlationId?: Uuid.UUID
      causationId?: Uuid.UUID
    }
  ): AlarmCreatedEvent => ({
    id: idProvider(),
    correlationId: data.correlationId ?? idProvider(),
    causationId: data.causationId ?? idProvider(),
    eventType,
    aggregateRootId: data.deviceId,
    entityId: data.alarmId
  })

  export const isAlarmCreatedEvent = (e: ChangeEvent): e is AlarmCreatedEvent => e.eventType === eventType
  export function assertAlarmCreatedEvent(e: ChangeEvent): asserts e is AlarmCreatedEvent {
    if (isAlarmCreatedEvent(e)) return
    throw new Error(`Unexpected EventType, Expected EventType: AlarmCreatedEvent, received ${typeof e}`)
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

    this.applyChangeEvent(AlarmCreatedEvent.make(Uuid.createV4, { deviceId: this.id, alarmId: id }))
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
