/** Shape of the JWT payload we sign and verify. */
export interface JwtPayload {
  /** User's primary key (cuid). Stored in the standard `sub` claim. */
  sub: string;
  email: string;
}
