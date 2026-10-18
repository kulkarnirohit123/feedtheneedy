import { handler } from './notifyDonor';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;

beforeEach(() => jest.clearAllMocks());

test('sends the 60-minute ack to the donor', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', donorPhone: '+91999' } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith(
    '+91999',
    'Thank you for sharing the information, driver will be available in next 60 minutes',
  );
  expect(result.requestId).toBe('req-1');
});
