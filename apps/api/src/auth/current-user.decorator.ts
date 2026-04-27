import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { JwtPayload } from "@bms/shared";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return req.user;
  },
);
