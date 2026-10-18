import { mockClient } from 'aws-sdk-client-mock';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { handleDonorMessage } from './donorHandler';
import * as dynamo from '../shared/dynamo';
import * as classifier from './classifier';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('./classifier');
jest.mock('../shared/whatsapp');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedClassifier = classifier as jest.Mocked<typeof classifier>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;
const sfnMock = mockClient(SFNClient);

beforeEach(() => {
  jest.clearAllMocks();
  sfnMock.reset();
  sfnMock.on(StartExecutionCommand).resolves({});
});

test('confident food donation offer creates a Request, sends donor ack, and starts the pipeline execution', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockResolvedValue({
    verdict: 'food_donation_offer',
    confidence: 0.9,
    extracted: { qty: '20 plates', foodType: 'vada pav', locationText: 'Koramangala' },
  });

  await handleDonorMessage({
    messageId: 'm1',
    fromPhone: '+91999',
    text: '20 vada pav leftover',
    geo: { lat: 1, lng: 2 },
  });

  expect(mockedDynamo.putRequest).toHaveBeenCalledTimes(1);
  const created = mockedDynamo.putRequest.mock.calls[0][0];
  expect(created.status).toBe('MATCHING');
  expect(mockedDynamo.putSpamLog).not.toHaveBeenCalled();

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledTimes(1);
  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith(
    '+91999',
    'Thank you for sharing the information, driver will be available in next 60 minutes',
  );

  const executions = sfnMock.commandCalls(StartExecutionCommand);
  expect(executions).toHaveLength(1);
  expect(JSON.parse(executions[0].args[0].input.input as string)).toEqual({ requestId: created.requestId });
});

test('low confidence offer does not start a pipeline execution', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockResolvedValue({
    verdict: 'food_donation_offer',
    confidence: 0.3,
    extracted: { qty: '?', foodType: '?', locationText: '?' },
  });

  await handleDonorMessage({ messageId: 'm5', fromPhone: '+91999', text: 'maybe have food' });

  expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
  expect(mockedWhatsapp.sendWhatsAppText).not.toHaveBeenCalled();
});

test('low confidence offer goes to PENDING_REVIEW, no dispatch', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockResolvedValue({
    verdict: 'food_donation_offer',
    confidence: 0.4,
    extracted: { qty: '?', foodType: '?', locationText: '?' },
  });

  await handleDonorMessage({ messageId: 'm2', fromPhone: '+91999', text: 'maybe have food' });

  const created = mockedDynamo.putRequest.mock.calls[0][0];
  expect(created.status).toBe('PENDING_REVIEW');
  expect(mockedWhatsapp.sendWhatsAppText).not.toHaveBeenCalled();
  expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
});

test('spam verdict is logged and dropped, no Request created', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockResolvedValue({ verdict: 'spam', confidence: 0.99 });

  await handleDonorMessage({ messageId: 'm3', fromPhone: '+91888', text: 'win a prize now' });

  expect(mockedDynamo.putRequest).not.toHaveBeenCalled();
  expect(mockedDynamo.putSpamLog).toHaveBeenCalledTimes(1);
  expect(mockedWhatsapp.sendWhatsAppText).not.toHaveBeenCalled();
  expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
});

test('classifier failure fails open to PENDING_REVIEW, never dropped', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockRejectedValue(new classifier.ClassifierError('boom'));

  await handleDonorMessage({ messageId: 'm4', fromPhone: '+91777', text: 'unclear message' });

  expect(mockedDynamo.putRequest).toHaveBeenCalledTimes(1);
  expect(mockedDynamo.putRequest.mock.calls[0][0].status).toBe('PENDING_REVIEW');
  expect(mockedWhatsapp.sendWhatsAppText).not.toHaveBeenCalled();
  expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
});

test('duplicate messageId is a no-op (idempotency)', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(true);

  await handleDonorMessage({ messageId: 'm1', fromPhone: '+91999', text: 'repeat' });

  expect(mockedClassifier.classifyMessage).not.toHaveBeenCalled();
  expect(mockedDynamo.putRequest).not.toHaveBeenCalled();
  expect(mockedWhatsapp.sendWhatsAppText).not.toHaveBeenCalled();
  expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
});
