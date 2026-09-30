import { bootstrapServeHost } from './serve/bootstrap.js';
import { startServeHttp } from './serve/http.js';

await bootstrapServeHost();
startServeHttp();
