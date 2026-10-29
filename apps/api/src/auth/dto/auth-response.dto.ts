import type { SafeUser } from '../../users/users.service.js';

/** Shape returned by /auth/register and /auth/login. */
export interface AuthResponseDto {
  accessToken: string;
  user: SafeUser;
}
