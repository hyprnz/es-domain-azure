import { CreateDeleteEntityAction, TableClient, odata, TableEntity, TableEntityResult } from '@azure/data-tables'
import { Aggregate, ChangeEvent, EntityEvent, Uuid, WriteModelRepository } from '@hyprnz/es-domain'
import EventEmitter from 'events'
import { WriteModelRepositoryError } from '@hyprnz/es-domain/dist/src/writeModelRepository/WriteModelRepositoryError'
import { OptimisticConcurrencyError } from '@hyprnz/es-domain/dist/src/writeModelRepository/OptimisticConcurrencyError'
import { InternalEventStoreRepository } from '@hyprnz/es-domain/dist/src/writeModelRepository/InternalEventStoreRepository'
import { StatusCodes } from '@azure/cosmos'

type EventStoreModel = ChangeEvent & { version: number }

export class TableStoreWriteRepository implements WriteModelRepository {
  private readonly eventEmitter = new EventEmitter()
  private readonly adapter: TableStoreAdapter

  constructor(store: TableClient) {
    this.adapter = new TableStoreAdapter(store)
  }

  async save<T extends Aggregate>(aggregateRoot: T): Promise<number> {
    const changes = aggregateRoot.uncommittedChanges()
    if (changes.length === 0) return Promise.resolve(0)
    const lastChange = changes[changes.length - 1]
    await this.adapter.appendEvents(aggregateRoot.id, lastChange.version, changes)
    aggregateRoot.markChangesAsCommitted(lastChange.version)
    this.onAfterEventsStored(changes)
    return changes.length
  }

  async load<T extends Aggregate>(id: Uuid.UUID, aggregate: T): Promise<T> {
    const events = await this.loadEvents(id)
    if (events.length === 0) {
      throw new WriteModelRepositoryError('AggregateContainer', `Failed to load aggregate id:${id}: NOT FOUND`)
    }
    aggregate.loadFromHistory(events)
    return aggregate
  }

  loadEvents(id: Uuid.UUID): Promise<EntityEvent[]> {
    return this.adapter.getEvents(id)
  }

  subscribeToChangesSynchronously(handler: (changes: Array<EntityEvent>) => void) {
    this.eventEmitter.addListener('events', handler)
  }

  private onAfterEventsStored(changes: Array<EntityEvent>) {
    if (changes.length) {
      this.eventEmitter.emit('events', changes)
    }
  }
}

export class TableStoreAdapter implements InternalEventStoreRepository {
  constructor(private store: TableClient) {}

  async appendEvents(aggregateId: Uuid.UUID, changeVersion: number, changes: EntityEvent[]): Promise<void> {
    const models = changes.map(x => this.toPersistable(x))
    console.log(JSON.stringify(models))
    const operations = models.map((x): CreateDeleteEntityAction => ['create', x])

    const txnResult = await this.store.submitTransaction(operations)
    const code = txnResult.status ?? 200

    if (code >= 400) {
      throw new WriteModelRepositoryError('AggregateRoot', `Cosmos Db Error: ${code}`)
    }

    if (code === 207) {
      const isConflicted = txnResult.subResponses.find(r => r.status === StatusCodes.Conflict)
      if (isConflicted) throw new OptimisticConcurrencyError(aggregateId, changeVersion)
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

    results.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
    return results
  }

  // TODO CreateDeleteEntityAction fixes the T in TableEntity to Record<string, unkown>
  // so we are unable to type TableEntity more narrowly - raise a bug in Azure GH.
  private toPersistable(change: EntityEvent): TableEntity {
    return {
      partitionKey: change.event.aggregateRootId,
      rowKey: change.event.id,
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

    console.log('To EntityEvent', JSON.stringify(result))
    return result
  }
}
