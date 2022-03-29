import { CosmosClient, CosmosClientOptions } from "@azure/cosmos";
import { Uuid } from "@hyprnz/es-domain";
import { assertThat, match } from "mismatched";
import { AlarmCreatedEvent } from "../../testAggregate/Device";
import { AlarmProjection, ALARM_PROJECTION, alarmProjection } from "../../testAggregate/AlarmProjection";
import { CosmosSqlReadRepository } from "./CosmosSqlReadRepository";
import { makeCosmosReadStoreMigrator } from "./makeMigrator";

describe("CosmosSqlReadRepository", () => {

  let client: CosmosClient;
  let readModelRepo: CosmosSqlReadRepository;
  const applyProjectionChanges = alarmProjection;

  before(async () => {
    const databaseId = 'testdb'
    const containerName = 'readstore'

    const COSMOS_KEY='C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='
    const COSMOS_ENDPOINT='https://cosmosdb.local:8081/'
    // Set up DB connection and new up the repository
    const options: CosmosClientOptions = { endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY }
    client = new CosmosClient(options)

    
    const migrator = await makeCosmosReadStoreMigrator(client, databaseId, containerName)
    await migrator.up()
    
    const database = client.database(databaseId)
    const container = database.container(containerName)

    readModelRepo = new CosmosSqlReadRepository(container);
  });

  after(() => {
    if (client) client.dispose();
  });

  it("persists and retrieves projections", async () => {
    // ARRANGE
    // Prepare a loan application projection.
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()
    const alarmCreatedEvent = AlarmCreatedEvent.make(() => alarmId, {alarmId, deviceId, name: 'Importnant Alarm'});

    
    // ACT
    await applyProjectionChanges(
      [{ version: 0, event: alarmCreatedEvent }], 
      readModelRepo
    );

    // ASSERT
    // Retrieve the projection that we just persisted.
    const persistedProjection = await readModelRepo.find<AlarmProjection>(
      ALARM_PROJECTION,
      alarmId
    );

    
    // Retrieved projection should be same as the one we persisted.
    assertThat(persistedProjection).is(
      match.obj.has({
        id: alarmId,
        version: 0,
        name: 'Importnant Alarm'
      })
    );
  });

  it("can update existing projections", async () => {
    // ARRANGE
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()
    const alarmCreatedEvent = AlarmCreatedEvent.make(() => alarmId, {alarmId, deviceId, name: 'Important Alarm'});
    
    await applyProjectionChanges(
      [{ version: 0, event: alarmCreatedEvent }], 
      readModelRepo
    );

    // ACT
    const anotherAlarmCreatedEvent = AlarmCreatedEvent.make(() => alarmId, {alarmId, deviceId, name: 'Active Alarm'});
    await applyProjectionChanges([{ version: 1, event: anotherAlarmCreatedEvent }], readModelRepo);

    const updatedProjection = await readModelRepo.find<AlarmProjection>(
      ALARM_PROJECTION,
      alarmId
    );

    // ASSERT
    // We know if the update worked if there is now an extra property of `approvedAmount` present on the projection.
    assertThat(updatedProjection).is(
      match.obj.has({
        id: alarmId,
        version: 1,
        name: 'Active Alarm'
      })
    );
  });

  it("can delete projections", async () => {
    // ARRANGE
    // Create an example projection to delete.
    const deviceId = Uuid.createV4()
    const alarmId = Uuid.createV4()
    const alarmCreatedEvent = AlarmCreatedEvent.make(() => alarmId, {alarmId, deviceId, name: 'Important Alarm'});

    await applyProjectionChanges(
      [{ version: 0, event: alarmCreatedEvent }], 
      readModelRepo
    );

    // Get it from the repo (required in order to delete it).
    const savedProjection = await readModelRepo.find<AlarmProjection>(
      ALARM_PROJECTION,
      alarmId
    );
    assertThat(savedProjection).is(match.obj.has({ id: alarmId }));

    // ACT
    // Delete the projection (NB: above assertion will error if `savedProjection` is undefined)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await readModelRepo.delete(ALARM_PROJECTION, savedProjection!);

    // ASSERT
    // Shouldn't be able to find this projection again in the DB.
    const deletedProjection = await readModelRepo.find<AlarmProjection>(
      ALARM_PROJECTION,
      deviceId
    );
    assertThat(deletedProjection).is(undefined);
  });

});
