import { PgDialect } from "drizzle-orm/pg-core";
import {
  acquireArtistNameLock,
  acquireArtistPlatformWriteLocks,
  acquirePlatformIdentityLock,
} from "../artistIdentityLocks";

const dialect = new PgDialect();

describe("artist identity advisory locks", () => {
  it("uses a transaction-scoped lock keyed by platform and ID", async () => {
    const execute = jest.fn().mockResolvedValue([]);

    await acquirePlatformIdentityLock(
      { execute } as never,
      "spotify",
      "spotify-123",
    );

    const query = dialect.sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("pg_advisory_xact_lock");
    expect(query.params).toEqual([
      "musicnerd:artist-platform:spotify:spotify-123",
    ]);
  });

  it("uses a separate namespace for normalized artist names", async () => {
    const execute = jest.fn().mockResolvedValue([]);

    await acquireArtistNameLock({ execute } as never, "jonathan pape");

    const query = dialect.sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("pg_advisory_xact_lock");
    expect(query.params).toEqual([
      "musicnerd:artist-name:jonathan pape",
    ]);
  });

  it("locks the stable artist/platform slot before each external ID", async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const database = { execute } as never;

    await acquireArtistPlatformWriteLocks(
      database,
      "artist-123",
      "spotify",
      "spotify-first",
    );
    await acquireArtistPlatformWriteLocks(
      database,
      "artist-123",
      "spotify",
      "spotify-second",
    );

    const params = execute.mock.calls.map(([query]) =>
      dialect.sqlToQuery(query).params[0]
    );
    expect(params).toEqual([
      "musicnerd:artist-platform-slot:artist-123:spotify",
      "musicnerd:artist-platform:spotify:spotify-first",
      "musicnerd:artist-platform-slot:artist-123:spotify",
      "musicnerd:artist-platform:spotify:spotify-second",
    ]);
  });
});
