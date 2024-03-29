import { BulkOperationType, Container, CreateOperationInput, JSONObject, OperationResponse, StatusCodes } from '@azure/cosmos'
import { ChangeEvent, EntityEvent, Uuid, OptimisticConcurrencyError, InternalEventStore, WriteModelRepositoryError } from '@hyprnz/es-domain'


type EventStoreModel = ChangeEvent & { version: number }

export class CosmosInternalEventStore implements InternalEventStore {
  constructor(private container: Container) {}

  getEventsAfterVersion(id: Uuid.UUID, version: number): Promise<EntityEvent[]> {
    return this.container.items
      .query<EventStoreModel>({
        query: 'SELECT * FROM EventStore e WHERE e.aggregateRootId = @aggregateRootId and e.version > @version order by e.version asc',
        parameters: [
          {
            name: '@aggregateRootId',
            value: id
          },
          {
            name: '@version',
            value: version
          }
        ]
      })
      .fetchAll()
      .then(result => result.resources.map(this.toEntityEvent))
  }

  async appendEvents(aggregateId: Uuid.UUID, changeVersion: number, changes: EntityEvent[]): Promise<void> {
    // const options = {
    //   disableAutomaticIdGeneration: true,
    //   consistencyLevel: 'Eventual'
    // }
    const clock = new Date().toISOString()
    const models = changes.map(x => this.toPersistable(clock, x))
    const operations: Array<CreateOperationInput> = models.map(x => ({
      // partitionKey: aggregateRoot.id,
      operationType: BulkOperationType.Create,
      resourceBody: x
    }))

    // NOTE: Batch sizes are limited to 100!!
    const statusResult = await this.container.items.batch(operations, aggregateId)

    const code = statusResult.code ?? 200
    if (code >= 400) {
      throw new WriteModelRepositoryError('AggregateRoot', `Cosmos Db Error: ${code}`)
    }

    if (code === 207) {
      const isConflicted = statusResult.result.some((x: OperationResponse) => x.statusCode === StatusCodes.Conflict)
      if (isConflicted) {
        throw new OptimisticConcurrencyError(aggregateId, changeVersion)
      }
    }
  }

  getEvents(id: Uuid.UUID): Promise<EntityEvent[]> {
    return this.container.items
      .query<EventStoreModel>({
        query: 'SELECT * FROM EventStore e WHERE e.aggregateRootId = @aggregateRootId order by e.version asc',
        parameters: [
          {
            name: '@aggregateRootId',
            value: id
          }
        ]
      })
      .fetchAll()
      .then(result => result.resources.map(this.toEntityEvent))
  }

  private toPersistable(clock: string, change: EntityEvent): JSONObject {
    return {
      version: change.version,
      // dateTimeOfEvent: clock,

      ...change.event
    }
  }

  // Maybe these should be injected ?
  private toEntityEvent(x: EventStoreModel): EntityEvent {
    const result = {
      version: x.version,
      event: {
        ...x,
        id: x.id,
        aggregateRootId: x.aggregateRootId,
        entityId: x.entityId,
        eventType: x.eventType
      }
    }

    // TODO : We have no generic way of detecting dates
    Object.keys(result.event)
      .filter(key => key.startsWith('_')) //Remove some cosmos built in properties, the structures we use for persisting may be adjusted ?
      .concat('version') // Why remove version this is a significant field that will be needed to perform logic!!
      .forEach(key => delete (result.event as Record<string, unknown>)[key])

    console.log('To EntityEvent', JSON.stringify(result))
    return result
  }
}
