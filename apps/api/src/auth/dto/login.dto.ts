import { IsByteLength, IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  /**
   * Cap at 72 UTF-8 bytes to match the bcrypt truncation boundary.
   * A password longer than 72 bytes could never match a stored hash (bcrypt
   * truncates at registration), so rejecting it here avoids a slow bcrypt
   * comparison that is guaranteed to fail.
   */
  @IsString()
  @IsNotEmpty()
  @IsByteLength(0, 72, {
    message: 'password must not exceed 72 bytes when encoded as UTF-8',
  })
  password!: string;
}
