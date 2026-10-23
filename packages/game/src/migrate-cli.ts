import { migrate } from "./migrate";
import { pool } from "./db";

migrate((m) => console.log(m))
  .then((done) => {
    console.log(done.length ? `${done.length} Migration(en) angewendet.` : "Datenbank ist aktuell.");
    return pool().end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
