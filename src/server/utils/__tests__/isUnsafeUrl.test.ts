import { isUnsafeUrl } from "../fetchPageContent";

describe("isUnsafeUrl", () => {
    it("allows normal https URLs", () => {
        expect(isUnsafeUrl("https://pitchfork.com/reviews/example")).toBe(false);
        expect(isUnsafeUrl("https://www.rollingstone.com/music")).toBe(false);
        expect(isUnsafeUrl("http://example.com")).toBe(false);
    });

    it("blocks localhost", () => {
        expect(isUnsafeUrl("http://localhost:3000/api/admin")).toBe(true);
        expect(isUnsafeUrl("http://127.0.0.1/secret")).toBe(true);
        expect(isUnsafeUrl("http://0.0.0.0:8080")).toBe(true);
        expect(isUnsafeUrl("http://[::1]/api")).toBe(true);
    });

    it("blocks private network ranges", () => {
        expect(isUnsafeUrl("http://10.0.0.1/internal")).toBe(true);
        expect(isUnsafeUrl("http://172.16.0.1/internal")).toBe(true);
        expect(isUnsafeUrl("http://172.31.255.255/internal")).toBe(true);
        expect(isUnsafeUrl("http://192.168.1.1/router")).toBe(true);
    });

    it("blocks cloud metadata endpoint", () => {
        expect(isUnsafeUrl("http://169.254.169.254/latest/meta-data/")).toBe(true);
    });

    it("blocks non-http protocols", () => {
        expect(isUnsafeUrl("ftp://example.com/file")).toBe(true);
        expect(isUnsafeUrl("file:///etc/passwd")).toBe(true);
        expect(isUnsafeUrl("javascript:alert(1)")).toBe(true);
    });

    it("blocks malformed URLs", () => {
        expect(isUnsafeUrl("not-a-url")).toBe(true);
        expect(isUnsafeUrl("")).toBe(true);
    });

    it("allows public 172.x addresses outside private range", () => {
        expect(isUnsafeUrl("http://172.15.0.1/ok")).toBe(false);
        expect(isUnsafeUrl("http://172.32.0.1/ok")).toBe(false);
    });

    it("blocks IPv6 unique local (fc00::/7)", () => {
        expect(isUnsafeUrl("http://[fc00::1]/internal")).toBe(true);
        expect(isUnsafeUrl("http://[fd12::1]/internal")).toBe(true);
    });

    it("blocks full IPv6 link-local range (fe80::/10 = fe80::–febf::)", () => {
        expect(isUnsafeUrl("http://[fe80::1]/internal")).toBe(true);
        expect(isUnsafeUrl("http://[fe81::1]/internal")).toBe(true);
        expect(isUnsafeUrl("http://[febf::1]/internal")).toBe(true);
    });

    it("blocks deprecated IPv6 site-local (fec0::/10)", () => {
        expect(isUnsafeUrl("http://[fec0::1]/internal")).toBe(true);
        expect(isUnsafeUrl("http://[feff::1]/internal")).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)", () => {
        expect(isUnsafeUrl("http://[::ffff:127.0.0.1]/")).toBe(true);
        expect(isUnsafeUrl("http://[::ffff:10.0.0.1]/")).toBe(true);
        expect(isUnsafeUrl("http://[::ffff:192.168.1.1]/")).toBe(true);
        expect(isUnsafeUrl("http://[::ffff:169.254.169.254]/")).toBe(true);
    });

    it("allows IPv4-mapped IPv6 with public IPs", () => {
        expect(isUnsafeUrl("http://[::ffff:8.8.8.8]/")).toBe(false);
    });
});
