import { Projection, ReadModelRepository, Uuid } from "@hyprnz/es-domain";
import { Container, JSONObject } from "@azure/cosmos";


// Allow us to create, update and read back out our projections.

export class CosmosSqlReadRepository implements ReadModelRepository {
  constructor(private store: Container) {}

  // Get a projection, given it's type, and based on it's ID.
  async find<T extends Projection>(projectionName: string, id: Uuid.UUID): Promise<T | undefined> {
    const result = await this.store
      .item(this.makeRowId(projectionName, { id: id }), projectionName)
      .read();
    return this.fromPersistable<T>(result.resource);
  }

  // Allows us to save a new projection to the database.
  async create<T extends Projection>(projectionName: string, state: T): Promise<void> {
    await this.store.items.create(this.toPersistable(projectionName, state));
  }

  // Replace a project in-place. Safe to do this as append-only store only valid for read model.
  // E.g. user changes their phone number, and we want the projection to represent this state change.
  async update<T extends Projection>(projectionName: string, state: T): Promise<void> {
    const response = await this.store.items.upsert(this.toPersistable(projectionName, state));
    if (response.statusCode >= 400) {
      throw new Error(`Failed to update projection Row, StatusCode:${response.statusCode}`);
    }
  }

  // Remove a projection (e.g. removing an invalid mailing address).
  async delete<T extends Projection>(projectionName: string, state: T): Promise<void> {
    await this.store.item(this.makeRowId(projectionName, state), projectionName).delete();
  }

  /** Transform the DB-stored JSON data into our projection object. */
  private fromPersistable<T extends Projection>(serialised: Record<string, any>): T | undefined {
    const projection = serialised ? serialised["projection"] : undefined;
    return isProjection(projection) ? (projection as T) : undefined;
  }

  // We want to transform our projection object into something that the DB can store (e.g. JSON)
  private toPersistable<T extends Projection>(projectionName: string, state: T): JSONObject {
    return {
      id: this.makeRowId(projectionName, state),
      projectionName,
      projection: {
        ...state,
      },
    } as any as JSONObject;
  }

  private makeRowId(projectionName: string, state: { id: Uuid.UUID }) {
    return state.id + ":" + projectionName;
  }
}

// TODO - Move this next to the definition of Projection (in `es-domain` package).
function isProjection(maybeProjection: unknown): maybeProjection is Projection {
  const projection = maybeProjection as Projection;
  return !!(projection && projection.id && !isNaN(projection.version));
}
