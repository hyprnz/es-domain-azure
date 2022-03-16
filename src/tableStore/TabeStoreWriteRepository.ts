import { CreateDeleteEntityAction, TableClient, odata } from '@azure/data-tables'
import { Aggregate, ChangeEvent, EntityEvent, Uuid, WriteModelRepository } from '@hyprnz/es-domain'
import EventEmitter from 'events'
import { WriteModelRepositoryError } from '@hyprnz/es-domain/dist/src/writeModelRepository/WriteModelRepositoryError'
import { OptimisticConcurrencyError } from '@hyprnz/es-domain/dist/src/writeModelRepository/OptimisticConcurrencyError'
import { InternalEventStoreRepository } from '@hyprnz/es-domain/dist/src/writeModelRepository/InternalEventStoreRepository'
import { StatusCodes } from '@azure/cosmos'

type EventStoreModel = ChangeEvent & { version: number }

class TableStoreWriteRepository implements WriteModelRepository {
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

    // TODO this is gross
    let results: EntityEvent[] = []
    for await (const entity of paginatedResult) {
      results.push(this.toEntityEvent(entity))
    }

    return results
  }

  private toPersistable(change: EntityEvent) {
    //: TableEntity<EventStoreModel> {
    return {
      partitionKey: change.event.aggregateRootId,
      rowKey: change.event.id,
      version: change.version,
      ...change.event
    }
  }

  private toEntityEvent(x: EventStoreModel): EntityEvent {
    const result: EntityEvent = {
      version: x.version,
      event: {
        ...x,
        id: x.id,
        aggregateRootId: x.aggregateRootId,
        entityId: x.entityId,
        eventType: x.eventType
      }
    }

    console.log('To EntityEvent', JSON.stringify(result))
    return result
  }
}
