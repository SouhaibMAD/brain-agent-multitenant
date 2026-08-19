export interface JwtPayload {
  userId: string;
  email: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}