jest.mock('node-cron');
jest.mock('../../adapters/db/idempotencyRepo');

import * as cron from 'node-cron';
import * as idempotencyRepo from '../../adapters/db/idempotencyRepo';
import { initIdempotencyKeysCleanupCron } from '../../utils/cronJobs';

const mockCron = jest.mocked(cron);
const mockRepo = jest.mocked(idempotencyRepo);

type CronTask = () => Promise<void>;

const captureScheduledTask = (): CronTask => {
  const call = mockCron.schedule.mock.calls.find((c) => c[0] === '30 4 * * *');
  if (!call) throw new Error('idempotency cleanup cron was not scheduled');
  return call[1] as unknown as CronTask;
};

describe('initIdempotencyKeysCleanupCron', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('schedules a daily 4:30 AM job', () => {
    initIdempotencyKeysCleanupCron();
    expect(mockCron.schedule).toHaveBeenCalledWith('30 4 * * *', expect.any(Function), { timezone: 'America/Argentina/Buenos_Aires' });
  });

  it('purges keys older than the 72h TTL when the job runs', async () => {
    mockRepo.deleteExpiredKeys.mockResolvedValue(5);
    initIdempotencyKeysCleanupCron();

    await captureScheduledTask()();

    expect(mockRepo.deleteExpiredKeys).toHaveBeenCalledWith(72);
  });

  it('swallows repo errors so the scheduler stays alive', async () => {
    mockRepo.deleteExpiredKeys.mockRejectedValue(new Error('db down'));
    initIdempotencyKeysCleanupCron();

    await expect(captureScheduledTask()()).resolves.toBeUndefined();
  });
});
