import { NextFunction, Request, Response, RequestHandler } from "express";

// Express 4 tidak meneruskan Promise rejection dari handler async ke error
// middleware — tanpa wrapper ini, error database membuat request menggantung
// tanpa respons sama sekali.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
