import { makeProjection, Projection, StaticProjectionEventHandler, Uuid } from '@hyprnz/es-domain';
import { DeviceCreatedEvent } from './Device';

export interface DeviceCountProjection extends Projection {
  /** Count of all devices*/
  countOfDevices: number
}

const eventHandlers: Record<string, StaticProjectionEventHandler<DeviceCountProjection>> = {
  [DeviceCreatedEvent.eventType]: (state, evt) => {
    state.countOfDevices++
    return 'update'
  },  
}

const defaultValue = (id: Uuid.UUID): DeviceCountProjection => ({
  id,
  version: 0,
  countOfDevices: 0,
})

export const DEVICE_COUNT_PROJECTION = 'allDevices'
export const totalDeviceCount = makeProjection<DeviceCountProjection>(
  DEVICE_COUNT_PROJECTION,
  eventHandlers,
  defaultValue,
  evt => Uuid.makeWelKnownUuid('d855f06c-89a2-4600-be96-2d86e9f0bff4')
)

