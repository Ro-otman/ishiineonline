import { ensurePaymentsTable } from '../models/payments.model.js';

try {
  await ensurePaymentsTable();
  console.log('payments_table_ok');
} catch (error) {
  console.error('payments_table_failed', {
    message: error?.message,
    code: error?.code,
    sqlMessage: error?.sqlMessage,
  });
  process.exitCode = 1;
}
