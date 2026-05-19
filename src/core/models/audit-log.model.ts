export enum AuditAction {
  // Auth
  LOGIN_SUCCESS = 'login_success',
  LOGIN_ERROR = 'login_error',
  LOGOUT = 'logout',
  USER_REGISTERED = 'user_registered',
  USER_REGISTER_ERROR = 'user_register_error',

  // User Management (Admin)
  USER_CREATED = 'user_created',
  USER_CREATE_ERROR = 'user_create_error',
  USER_UPDATED = 'user_updated',
  USER_UPDATE_ERROR = 'user_update_error',
  USER_STATUS_CHANGED = 'user_status_changed',
  USER_STATUS_ERROR = 'user_status_error',
  USER_PASSWORD_RESET_SENT = 'user_password_reset_sent',
  USER_PASSWORD_RESET_ERROR = 'user_password_reset_error',

  // Cargos
  CARGO_CREATED = 'cargo_created',
  CARGO_CREATE_ERROR = 'cargo_create_error',
  CARGO_UPDATED = 'cargo_updated',
  CARGO_UPDATE_ERROR = 'cargo_update_error',
  CARGO_STATUS_CHANGED = 'cargo_status_changed',
  CARGO_STATUS_ERROR = 'cargo_status_error',

  // Companies
  COMPANY_CREATED = 'company_created',
  COMPANY_CREATE_ERROR = 'company_create_error',
  COMPANY_UPDATED = 'company_updated',
  COMPANY_UPDATE_ERROR = 'company_update_error',
  COMPANY_CLIENT_CREATED = 'company_client_created',
  COMPANY_CLIENT_CREATE_ERROR = 'company_client_create_error',
  COMPANY_STATUS_CHANGED = 'company_status_changed',
  COMPANY_STATUS_ERROR = 'company_status_error',

  // Company-specific links
  COMPANY_CARGO_LINKED = 'company_cargo_linked',
  COMPANY_CARGO_LINK_ERROR = 'company_cargo_link_error',
  COMPANY_CARGO_UPDATED = 'company_cargo_updated',
  COMPANY_CARGO_UPDATE_ERROR = 'company_cargo_update_error',
  COMPANY_CARGO_DELETED = 'company_cargo_deleted',
  COMPANY_CARGO_DELETE_ERROR = 'company_cargo_delete_error',

  COMPANY_EQUIPMENT_LINKED = 'company_equipment_linked',
  COMPANY_EQUIPMENT_LINK_ERROR = 'company_equipment_link_error',
  COMPANY_EQUIPMENT_UPDATED = 'company_equipment_updated',
  COMPANY_EQUIPMENT_UPDATE_ERROR = 'company_equipment_update_error',
  COMPANY_EQUIPMENT_DELETED = 'company_equipment_deleted',
  COMPANY_EQUIPMENT_DELETE_ERROR = 'company_equipment_delete_error',

  COMPANY_RISK_LINKED = 'company_risk_linked',
  COMPANY_RISK_LINK_ERROR = 'company_risk_link_error',
  COMPANY_RISK_UPDATED = 'company_risk_updated',
  COMPANY_RISK_UPDATE_ERROR = 'company_risk_update_error',
  COMPANY_RISK_DELETED = 'company_risk_deleted',
  COMPANY_RISK_DELETE_ERROR = 'company_risk_delete_error',
  COMPANY_RISK_CREATED = 'company_risk_created',
  COMPANY_RISK_CREATE_ERROR = 'company_risk_create_error',

  // Employees
  EMPLOYEE_CREATED = 'employee_created',
  EMPLOYEE_CREATE_ERROR = 'employee_create_error',
  EMPLOYEE_UPDATED = 'employee_updated',
  EMPLOYEE_UPDATE_ERROR = 'employee_update_error',
  EMPLOYEE_VIEWED = 'employee_viewed',

  // Equipments
  EQUIPMENT_CREATED = 'equipment_created',
  EQUIPMENT_CREATE_ERROR = 'equipment_create_error',
  EQUIPMENT_UPDATED = 'equipment_updated',
  EQUIPMENT_UPDATE_ERROR = 'equipment_update_error',

  // Risks
  RISK_CREATED = 'risk_created',
  RISK_CREATE_ERROR = 'risk_create_error',
  RISK_UPDATED = 'risk_updated',
  RISK_UPDATE_ERROR = 'risk_update_error',

  // Sectors
  SECTOR_CREATED = 'sector_created',
  SECTOR_CREATE_ERROR = 'sector_create_error',
  SECTOR_UPDATED = 'sector_updated',
  SECTOR_UPDATE_ERROR = 'sector_update_error',
  SECTOR_STATUS_CHANGED = 'sector_status_changed',
  SECTOR_STATUS_ERROR = 'sector_status_error',
  SECTOR_VIEWED = 'sector_viewed',

  // Units
  UNIT_CREATED = 'unit_created',
  UNIT_CREATE_ERROR = 'unit_create_error',
  UNIT_UPDATED = 'unit_updated',
  UNIT_UPDATE_ERROR = 'unit_update_error',
  UNIT_STATUS_CHANGED = 'unit_status_changed',
  UNIT_STATUS_ERROR = 'unit_status_error',

  // Licenses
  LICENSE_CREATED = 'license_created',
  LICENSE_CREATE_ERROR = 'license_create_error',
  LICENSE_UPDATED = 'license_updated',
  LICENSE_UPDATE_ERROR = 'license_update_error',
  LICENSE_DELETED = 'license_deleted',
  LICENSE_DELETE_ERROR = 'license_delete_error',
  LICENSE_DOCUMENT_UPLOADED = 'license_document_uploaded',
  CONDITION_CREATED = 'condition_created',
  CONDITION_CREATE_ERROR = 'condition_create_error',
  CONDITION_UPDATED = 'condition_updated',
  CONDITION_UPDATE_ERROR = 'condition_update_error',
  CONDITION_MARKED_AS_CUMPRIDA = 'condition_marked_as_cumprida',
  CONDITION_DOCUMENT_UPLOADED = 'condition_document_uploaded',
  CONDITION_DELETED = 'condition_deleted',
  CONDITION_SOFT_DELETED = 'condition_soft_deleted',
  CONDITION_RESTORED = 'condition_restored',

  // EPI Deliveries
  EPI_DELIVERY_CREATED = 'epi_delivery_created',
  EPI_DELIVERY_CREATE_ERROR = 'epi_delivery_create_error',
  EPI_DELIVERY_UPDATED = 'epi_delivery_updated',
  EPI_DELIVERY_UPDATE_ERROR = 'epi_delivery_update_error',
  EPI_DELIVERY_DELETED = 'epi_delivery_deleted',
  EPI_DELIVERY_SIGNED = 'epi_delivery_signed',
  EPI_DELIVERY_DOCUMENT_UPLOADED = 'epi_delivery_document_uploaded',
  EPI_DELIVERY_TERM_DOWNLOADED = 'epi_delivery_term_downloaded',

  // Alerts
  ALERTS_GENERATED = 'alerts_generated',
  ALERTS_GENERATE_ERROR = 'alerts_generate_error',
  ALERTS_DELETED_BY_ORIGIN = 'alerts_deleted_by_origin',
  ALERTS_DELETE_ORIGIN_ERROR = 'alerts_delete_origin_error',
  ALERTS_DELETED_BY_PREFIX = 'alerts_deleted_by_prefix',
  ALERTS_DELETE_PREFIX_ERROR = 'alerts_delete_prefix_error',

  // Invites
  INVITE_EMAIL_SENT = 'invite_email_sent',
  INVITE_EMAIL_ERROR = 'invite_email_error',
}

export interface AuditLog {
  id?: string;
  action: AuditAction | string;
  description?: string;
  appVersion: string;
  details: any;
  user_profile: string;
  osVersion: string;
  timestamp: string;
  userEmail: string;
  userId: string;
  origin: string; // 'web' como solicitado
  day: number;
  month: number;
  year: number;
}
