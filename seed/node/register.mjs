// Lets plain Node 22+ import the Vite frontends' .ts files (extensionless imports, .css).
import { register } from "node:module";
register("./ts-resolve.mjs", import.meta.url);
