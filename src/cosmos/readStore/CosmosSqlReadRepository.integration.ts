import { ContainerRequest, CosmosClient, CosmosClientOptions } from "@azure/cosmos";
import { EntityEvent, Uuid } from "@hyprnz/es-domain";
import { assertThat, match } from "mismatched";
import { DeviceCreatedEvent } from "../../testAggregate/Device";
import { DeviceCountProjection, DEVICE_COUNT_PROJECTION, totalDeviceCount } from "../../testAggregate/DeviceCountProjection";
import { CosmosSqlReadRepository } from "./CosmosSqlReadRepository";

describe("CosmosSqlReadRepository", () => {

  let cosmosClient: CosmosClient;
  let readModelRepo: CosmosSqlReadRepository;
  const applyProjectionChanges = totalDeviceCount;

  beforeAll(async () => {
    // Set up DB connection and new up the repository
    const options: CosmosClientOptions = { endpoint: 'localhost', key: 'some-key' }
    const cosmosClient = new CosmosClient(options)

    const { database } = await cosmosClient.databases.createIfNotExists({
      id: "testReadDb",
    });

    const containerSettings: ContainerRequest = {
      id: "testProjectionStore",
      partitionKey: {
        paths: ["/projectionName"],
      },
      indexingPolicy: {
        indexingMode: "consistent",
      },
      // uniqueKeyPolicy: {
      //   uniqueKeys: [{ paths: ["/projectionName", "/id"] }],
      // },
    };
    const { container, resource } = await database.containers.createIfNotExists(containerSettings);

    if (resource) readModelRepo = new CosmosSqlReadRepository(container);
  });

  afterAll(() => {
    if (cosmosClient) cosmosClient.dispose();
  });

  it("persists and retrieves projections", async () => {
    // ARRANGE
    // Prepare a loan application projection.
    const deviceId = Uuid.createV4();
    const deviceCreatedEvent = DeviceCreatedEvent.make(() => deviceId, {deviceId});
    // ACT
    // Persist this projection (calls `CosmosSqlReadRepository.readModelRepo.create`)
    
    
    await applyProjectionChanges(
      [{ version: 0, event: deviceCreatedEvent }], 
      readModelRepo
    );

    // Retrieve the projection that we just persisted.
    const persistedProjection = await readModelRepo.find<DeviceCountProjection>(
      DEVICE_COUNT_PROJECTION,
      deviceId
    );

    // ASSERT
    // Retrieved projection should be same as the one we persisted.
    assertThat(persistedProjection).is(
      match.obj.has({
        id: deviceId,
        version: 0,
        countOfDevices: 1
      })
    );
  });

  it("can update existing projections", async () => {
    // ARRANGE
    // Set up an initial loan to work from.
    const deviceId = Uuid.createV4();
    const deviceCreatedEvent = DeviceCreatedEvent.make(() => deviceId, {deviceId});
    
    await applyProjectionChanges(
      [{ version: 0, event: deviceCreatedEvent }], 
      readModelRepo
    );

    // ACT
    // Add a new device
    await applyProjectionChanges([{ version: 1, event: deviceCreatedEvent }], readModelRepo);

    const updatedProjection = await readModelRepo.find<DeviceCountProjection>(
      DEVICE_COUNT_PROJECTION,
      deviceId
    );

    // ASSERT
    // We know if the update worked if there is now an extra property of `approvedAmount` present on the projection.
    assertThat(updatedProjection).is(
      match.obj.has({
        id: deviceId,
        version: 1,
        countOfDevices: 2
      })
    );
  });

  it("can delete projections", async () => {
    // ARRANGE
    // Create an example projection to delete.
    const deviceId = Uuid.createV4();
    const deviceCreatedEvent = DeviceCreatedEvent.make(() => deviceId, {deviceId});
    await applyProjectionChanges(
      [{ version: 0, event: deviceCreatedEvent }], 
      readModelRepo
    );

    // Get it from the repo (required in order to delete it).
    const savedProjection = await readModelRepo.find<DeviceCountProjection>(
      DEVICE_COUNT_PROJECTION,
      deviceId
    );
    assertThat(savedProjection).is(match.obj.has({ id: deviceId }));

    // ACT
    // Delete the projection (NB: above assertion will error if `savedProjection` is undefined)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await readModelRepo.delete(DEVICE_COUNT_PROJECTION, savedProjection!);

    // ASSERT
    // Shouldn't be able to find this projection again in the DB.
    const deletedProjection = await readModelRepo.find<DeviceCountProjection>(
      DEVICE_COUNT_PROJECTION,
      deviceId
    );
    assertThat(deletedProjection).is(undefined);
  });

});
