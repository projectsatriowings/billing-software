import type {
  CardTerminal,
  TerminalTransaction,
  TerminalProvider,
  TerminalConnectionMode,
  TerminalStatus,
  TerminalTxStatus,
  CardNetwork,
} from '../../../../shared/types.ts';

export type {
  CardTerminal,
  TerminalTransaction,
  TerminalProvider,
  TerminalConnectionMode,
  TerminalStatus,
  TerminalTxStatus,
  CardNetwork,
};

export interface CardTerminalRecord {
  id: string;
  tenantId: string;
  tenant_id?: string;
  branchId: string;
  branch_id?: string;
  counter: string | null;
  name: string;
  provider: TerminalProvider;
  model: string | null;
  serialNumber: string | null;
  serial_number?: string | null;
  terminalId: string | null;
  terminal_id?: string | null;
  merchantId: string | null;
  merchant_id?: string | null;
  connectionMode: TerminalConnectionMode;
  connection_mode?: TerminalConnectionMode;
  ipAddress: string | null;
  ip_address?: string | null;
  port: number | null;
  apiEndpoint: string | null;
  api_endpoint?: string | null;
  authTokenEncrypted: string | null;
  auth_token_encrypted?: string | null;
  secretKeyEncrypted: string | null;
  secret_key_encrypted?: string | null;
  active: boolean;
  status: TerminalStatus;
  lastSeenAt: string | null;
  last_seen_at?: string | null;
  config: Record<string, any>;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
}

export interface TerminalTransactionRecord {
  id: string;
  tenantId: string;
  tenant_id?: string;
  branchId: string;
  branch_id?: string;
  terminalId: string;
  terminal_id?: string;
  invoiceId: string | null;
  invoice_id?: string | null;
  counter: string | null;
  amountMinor: number;
  amount_minor?: number | string;
  currency: string;
  provider: TerminalProvider;
  connectionMode: TerminalConnectionMode;
  connection_mode?: TerminalConnectionMode;
  providerTxId: string | null;
  provider_tx_id?: string | null;
  providerRefNo: string | null;
  provider_ref_no?: string | null;
  cardNetwork: CardNetwork | null;
  card_network?: CardNetwork | null;
  cardLast4: string | null;
  card_last4?: string | null;
  authCode: string | null;
  auth_code?: string | null;
  status: TerminalTxStatus;
  errorReason: string | null;
  error_reason?: string | null;
  idempotencyKey: string | null;
  idempotency_key?: string | null;
  cashierId: string;
  cashier_id?: string;
  cashierName: string | null;
  cashier_name?: string | null;
  verifiedAt: string | null;
  verified_at?: string | null;
  verifiedBy: 'api' | 'cashier_manual' | 'webhook' | null;
  verified_by?: 'api' | 'cashier_manual' | 'webhook' | null;
  reconciled: boolean;
  reconciledAt: string | null;
  reconciled_at?: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
}

export interface DecryptedSecrets {
  authToken?: string;
  secretKey?: string;
}

export interface InitiatePaymentParams {
  terminal: CardTerminalRecord;
  amountMinor: number;
  invoiceId?: string;
  counter?: string;
  cashierId: string;
  cashierName?: string;
  idempotencyKey?: string;
  decryptedSecrets: DecryptedSecrets;
  metadata?: Record<string, any>;
}

export interface InitiatePaymentResult {
  status: TerminalTxStatus;
  providerTxId?: string;
  providerRefNo?: string;
  instructions?: string;
  cardNetwork?: CardNetwork;
  cardLast4?: string;
  authCode?: string;
  errorReason?: string;
  rawResponse?: any;
}

export interface CheckStatusParams {
  terminal: CardTerminalRecord;
  transaction: TerminalTransactionRecord;
  decryptedSecrets: DecryptedSecrets;
}

export interface TerminalStatusResult {
  status: TerminalTxStatus;
  providerTxId?: string;
  providerRefNo?: string;
  cardNetwork?: CardNetwork;
  cardLast4?: string;
  authCode?: string;
  errorReason?: string;
  rawResponse?: any;
}

export interface CancelPaymentParams {
  terminal: CardTerminalRecord;
  transaction: TerminalTransactionRecord;
  decryptedSecrets: DecryptedSecrets;
}

export interface CancelPaymentResult {
  cancelled: boolean;
  message?: string;
  errorReason?: string;
  rawResponse?: any;
}

export interface RefundPaymentParams {
  terminal: CardTerminalRecord;
  transaction: TerminalTransactionRecord;
  refundAmountMinor: number;
  decryptedSecrets: DecryptedSecrets;
}

export interface RefundPaymentResult {
  status: 'success' | 'failed' | 'unsupported';
  refundTxId?: string;
  message?: string;
  errorReason?: string;
  rawResponse?: any;
}

export interface ReconcileParams {
  terminal: CardTerminalRecord;
  transaction: TerminalTransactionRecord;
  decryptedSecrets: DecryptedSecrets;
}

export interface ReconcileResult {
  matched: boolean;
  providerStatus: string;
  amountMinor?: number;
  providerRefNo?: string;
  discrepancyNote?: string;
  rawResponse?: any;
}

export interface CallbackResult {
  handled: boolean;
  transactionId?: string;
  statusResult?: TerminalStatusResult;
  ackBody?: any;
}

export interface TerminalAdapter {
  readonly name: string;
  readonly provider: TerminalProvider;
  readonly connectionModes: readonly TerminalConnectionMode[];

  initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult>;
  getPaymentStatus(params: CheckStatusParams): Promise<TerminalStatusResult>;
  cancelPayment(params: CancelPaymentParams): Promise<CancelPaymentResult>;
  refundPayment?(params: RefundPaymentParams): Promise<RefundPaymentResult>;
  reconcileTransaction?(params: ReconcileParams): Promise<ReconcileResult>;
  handleCallback?(payload: any, signature?: string): Promise<CallbackResult>;
  pingTerminal?(terminal: CardTerminalRecord, decryptedSecrets: DecryptedSecrets): Promise<{ online: boolean; message?: string }>;
}
