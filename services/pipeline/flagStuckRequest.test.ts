import { handler } from './flagStuckRequest';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('flags the request PENDING_REVIEW, clears the stale task token, and frees the driver', async () => {
  mockedDynamo.getRequest.mockResolvedValue({
    requestId: 'req-1',
    driverId: 'd1',
    pendingTaskToken: 'stale-token',
    pendingStep: 'PICKUP_PHOTO',
    status: 'DRIVER_ACCEPTED',
  } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('d1', 'available');
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', {
    status: 'PENDING_REVIEW',
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });
  expect(result).toEqual({ requestId: 'req-1', status: 'PENDING_REVIEW' });
});

test('works with no driver assigned (the zero-driver / null-match path)', async () => {
  mockedDynamo.getRequest.mockResolvedValue({
    requestId: 'req-2',
    status: 'MATCHING',
  } as never);

  const result = await handler({ requestId: 'req-2' });

  expect(mockedDynamo.updateDriverStatus).not.toHaveBeenCalled();
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-2', {
    status: 'PENDING_REVIEW',
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });
  expect(result.status).toBe('PENDING_REVIEW');
});

test('a missing request neither throws nor writes a phantom row', async () => {
  mockedDynamo.getRequest.mockResolvedValue(null);

  await expect(handler({ requestId: 'ghost' })).resolves.toEqual({
    requestId: 'ghost',
    status: 'PENDING_REVIEW',
  });
  expect(mockedDynamo.updateRequest).not.toHaveBeenCalled();
  expect(mockedDynamo.updateDriverStatus).not.toHaveBeenCalled();
});
