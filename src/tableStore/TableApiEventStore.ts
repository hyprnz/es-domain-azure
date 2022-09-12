import { CreateDeleteEntityAction, TableClient, odata, TableEntity, TableEntityResult, RestError } from '@azure/data-tables'
import { ChangeEvent, EntityEvent, InternalEventStore, OptimisticConcurrencyError, Uuid } from '@hyprnz/es-domain'



type EventStoreModel = ChangeEvent & { version: number }

export class TableApiEventStore implements InternalEventStore {
  constructor(private store: TableClient) {}

  async appendEvents(aggregateId: Uuid.UUID, changeVersion: number, changes: EntityEvent[]): Promise<void> {
    const models = changes.map(x => this.toPersistable(x))
    const operations = models.map((x): CreateDeleteEntityAction => ['create', x])

    try {
      await this.store.submitTransaction(operations)
    } catch (e) {
      if (!(e instanceof RestError)) {
        throw new Error(`Unhandled error form Table API: ${JSON.stringify(e)}`)
      }

      switch (e.code) {
        case 'EntityAlreadyExists':
          throw new OptimisticConcurrencyError(aggregateId, changeVersion)
        default:
          throw e
      }
    }
  }

  async getEvents(id: Uuid.UUID): Promise<EntityEvent[]> {
    const paginatedResult = this.store.listEntities<EventStoreModel>({
      queryOptions: { filter: odata`PartitionKey eq ${id}` }
    })

    // TODO this is gross - be careful here as we might have a huge list of events.
    let results: EntityEvent[] = []
    for await (const entity of paginatedResult) {
      results.push(this.toEntityEvent(entity))
    }

    // TODO Table API might lexographically sort on partitionKey and rowKey so might not need to do this
    results.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
    return results
  }

  async getEventsAfterVersion(id: Uuid.UUID, version: number): Promise<EntityEvent[]> {
    const paginatedResult = this.store.listEntities<EventStoreModel>({
      queryOptions: { filter: odata`PartitionKey eq ${id} and RowKey gte ${version}` }
    })

    // TODO this is gross - be careful here as we might have a huge list of events.
    let results: EntityEvent[] = []
    for await (const entity of paginatedResult) {
      results.push(this.toEntityEvent(entity))
    }

    results.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
    return results
  }

  // TODO CreateDeleteEntityAction fixes the T in TableEntity to Record<string, unkown>
  // so we are unable to type TableEntity more narrowly - raise a bug in Azure GH.
  private toPersistable(change: EntityEvent): TableEntity {
    return {
      partitionKey: change.event.aggregateRootId,
      rowKey: Number(change.version).toString(),
      version: change.version,
      ...change.event
    }
  }

  private toEntityEvent(tableStoreResult: TableEntityResult<EventStoreModel>): EntityEvent {
    const { etag, partitionKey, rowKey, timestamp, version, ...changeEvent } = tableStoreResult
    const result: EntityEvent = {
      version: tableStoreResult.version,
      event: {
        ...changeEvent,
        id: tableStoreResult.id,
        aggregateRootId: tableStoreResult.aggregateRootId,
        entityId: tableStoreResult.entityId,
        eventType: tableStoreResult.eventType
      }
    }

    return result
  }
}
