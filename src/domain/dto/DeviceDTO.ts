export interface Device {
  id: number;
  user_context_id: number;
  push_token: string;
  platform: 'ios' | 'android' | 'web';
  device_name?: string;
  ip_address?: string;
  user_agent?: string;
  registered_at: Date;
  last_active: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationLog {
  id: number;
  device_id?: number;
  user_context_id: number;
  title?: string;
  body: string;
  data?: any;
  status: string;
  expo_ticket_id?: string;
  expo_receipt_id?: string;
  error_message?: string;
  sent_at: Date;
  delivered_at?: Date;
  created_at: Date;
}