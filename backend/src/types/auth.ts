export type JwtUser = {
  id: number;
  email: string;
  role: 'user' | 'admin';
};
