import {
  IsByteLength,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  /**
   * Password constraints:
   * - Minimum 8 characters (character count, not bytes).
   * - Maximum 72 UTF-8 bytes, because bcrypt silently truncates inputs beyond
   *   that limit. A character-based MaxLength(72) would under-count multibyte
   *   characters (e.g. emoji = 4 bytes each), so we use @IsByteLength instead.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @IsByteLength(0, 72, {
    message: 'password must not exceed 72 bytes when encoded as UTF-8',
  })
  password!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
