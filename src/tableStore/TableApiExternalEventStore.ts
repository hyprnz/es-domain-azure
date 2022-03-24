import { RestError, TableClient, TableEntity, TableEntityResult } from '@azure/data-tables'
import { ExternalEvent } from '@hyprnz/es-domain'
import { ExternalEventStoreRepository } from '@hyprnz/es-domain/dist/src/eventStoreExternal/ExternalEventStoreRepository'
import { IdempotencyError } from '@hyprnz/es-domain/dist/src/eventStoreExternal/IdempotencyError'

export class TableApiExternalEventStore implements ExternalEventStoreRepository {
  constructor(private readonly tableClient: TableClient) {}

  async appendEvent(externalEvent: ExternalEvent): Promise<void> {
    try {
      await this.tableClient.createEntity(this.toPersistable(externalEvent))
    } catch (e) {
      if (!(e instanceof RestError)) {
        throw new Error(`Unhandled error form Table API: ${JSON.stringify(e)}`)
      }

      switch (e.code) {
        case 'EntityAlreadyExists':
          throw new IdempotencyError(externalEvent.id, externalEvent.eventId)
        default:
          throw e
      }
    }
  }

  private toPersistable(event: ExternalEvent): TableEntity {
    return {
      partitionKey: 'external-events',
      rowKey: event.eventId,
      ...event
    }
  }

  async getByEventId(eventId: string): Promise<ExternalEvent> {
    try {
      const result = await this.tableClient.getEntity<ExternalEvent>('external-events', eventId)
      return this.toEntityEvent(result)
    } catch (e) {
      if (!(e instanceof RestError)) {
        throw new Error(`Unhandled error form Table API: ${JSON.stringify(e)}`)
      }
      throw e
    }
  }

  private toEntityEvent(tableStoreResult: TableEntityResult<ExternalEvent>): ExternalEvent {
    const { etag, partitionKey, rowKey, timestamp, ...changeEvent } = tableStoreResult
    return changeEvent
  }
}
