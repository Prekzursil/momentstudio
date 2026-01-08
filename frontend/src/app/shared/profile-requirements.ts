import { AuthUser } from '../core/auth.service';

export type RequiredProfileField = 'name' | 'username' | 'first_name' | 'last_name' | 'date_of_birth' | 'phone';

function cleaned(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function missingRequiredProfileFields(user: Partial<AuthUser> | null | undefined): RequiredProfileField[] {
  const missing: RequiredProfileField[] = [];
  if (!user) return ['name', 'username', 'first_name', 'last_name', 'date_of_birth', 'phone'];

  if (!cleaned(user.name)) missing.push('name');
  if (!cleaned(user.username)) missing.push('username');
  if (!cleaned(user.first_name)) missing.push('first_name');
  if (!cleaned(user.last_name)) missing.push('last_name');
  if (!cleaned(user.date_of_birth)) missing.push('date_of_birth');
  if (!cleaned(user.phone)) missing.push('phone');
  return missing;
}

export function isProfileComplete(user: Partial<AuthUser> | null | undefined): boolean {
  return missingRequiredProfileFields(user).length === 0;
}

