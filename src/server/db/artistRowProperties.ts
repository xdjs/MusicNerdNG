/**
 * Where a physical column name and its Drizzle row property disagree.
 *
 * `facebookID` is the column; `facebookId` is the property you index the row
 * with. Code that holds a list of column names — and several places do, because
 * urlmap keys on column names — reads `undefined` unless it translates first.
 * That is how discovery stopped recognising an artist's own numeric Facebook
 * profile: it looked up `row["facebookID"]`, got nothing, and concluded they
 * did not have one, so their own profile could be filed as press about them.
 *
 * IN ITS OWN MODULE ON PURPOSE. It lived in artistLinkService, which the test
 * suite mocks wholesale — so importing it from there made every consumer's
 * tests fail on an undefined constant, and the obvious repair (patching each
 * mock, or optional-chaining the lookup) would hide a genuinely missing export
 * in production. A constant with no behaviour has no reason to sit behind a
 * mock.
 */
export const ARTIST_ROW_PROPERTY_BY_COLUMN: Record<string, string> = {
    facebookID: "facebookId",
    tiktokID: "tiktokId",
};

/** The property to read for a column, which is usually the column itself. */
export function artistRowProperty(column: string): string {
    return ARTIST_ROW_PROPERTY_BY_COLUMN[column] ?? column;
}
