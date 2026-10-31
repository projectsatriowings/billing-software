export interface PasswordValidation {
  hasMinLength: boolean;
  hasNumber: boolean;
  hasMix: boolean;
  isDifferentFromCurrent: boolean;
  isValid: boolean;
  strengthScore: number; // 0 to 4
  strengthLabel: 'Too weak' | 'Weak' | 'Medium' | 'Strong';
  strengthColor: string;
}

export function evaluatePassword(newPassword: string, currentPassword?: string): PasswordValidation {
  const pw = newPassword || '';
  const cur = currentPassword || '';

  const hasMinLength = pw.length >= 8;
  const hasNumber = /\d/.test(pw);
  
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasSymbol = /[^a-zA-Z0-9]/.test(pw);
  const varieties = [hasLower, hasUpper, hasNumber, hasSymbol].filter(Boolean).length;
  // Mix of uppercase, lowercase or symbols (at least 2 kinds of lower/upper/symbol)
  const hasMix = [hasLower, hasUpper, hasSymbol].filter(Boolean).length >= 2;

  const isDifferentFromCurrent = cur ? pw !== cur && pw.length > 0 : true;

  // Strength score from 0 to 4
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 10 && varieties >= 3) score++;
  if (hasNumber && hasSymbol) score++;
  if (hasUpper && hasLower && pw.length >= 12) score++;

  if (pw.length > 0 && score === 0) score = 1;

  let strengthLabel: 'Too weak' | 'Weak' | 'Medium' | 'Strong' = 'Too weak';
  let strengthColor = '#E53E3E'; // Red

  if (score >= 4) {
    strengthLabel = 'Strong';
    strengthColor = '#10B981'; // Green
  } else if (score === 3) {
    strengthLabel = 'Medium';
    strengthColor = '#F59E0B'; // Amber
  } else if (score === 2) {
    strengthLabel = 'Weak';
    strengthColor = '#F97316'; // Orange
  } else {
    strengthLabel = 'Too weak';
    strengthColor = '#EF4444'; // Red
  }

  const isValid = hasMinLength && hasNumber && varieties >= 3 && isDifferentFromCurrent;

  return {
    hasMinLength,
    hasNumber,
    hasMix: varieties >= 3,
    isDifferentFromCurrent,
    isValid,
    strengthScore: score,
    strengthLabel,
    strengthColor,
  };
}

