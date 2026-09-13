using System.Net;
using DFH.Core.Library;
using Xunit;

namespace DFH.Core.Tests;

public class LibraryTests
{
    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<string> Requested { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requested.Add(request.RequestUri!.ToString());
            return Task.FromResult(respond(request));
        }
    }

    private static HttpResponseMessage Text(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body) };

    [Fact]
    public void Unwraps_the_jsonp_wrapper()
    {
        using var document = Jsonp.Unwrap("__dfh(\"catalog/a\", {\"r\":[[\"abc\",\"歌\"]]});", out var key);

        Assert.Equal("catalog/a", key);
        Assert.Equal("歌", document.RootElement.GetProperty("r")[0][1].GetString());
    }

    [Fact]
    public void Rejects_non_jsonp_bodies()
    {
        Assert.Throws<LibraryException>(() => Jsonp.Unwrap("<html>nope</html>", out _));
    }

    [Fact]
    public async Task Loads_only_populated_shards_and_sorts_by_update_time()
    {
        var handler = new StubHandler(request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/index.js")) return Text("__dfh(\"index\", {\"v\":1,\"n\":3,\"t\":5,\"s\":{\"a\":2,\"b\":0,\"c\":1}});");
            if (path.EndsWith("/catalog/a.js")) return Text("__dfh(\"catalog/a\", {\"r\":[[\"id1\",\"Alpha\",\"\",\"\",\"\",[\"流行\"],2,120,60000,100,10],[\"id2\",\"Beta\",\"Comp\",\"Up\",\"\",null,0,0,0,0,30]]});");
            if (path.EndsWith("/catalog/c.js")) return Text("__dfh(\"catalog/c\", {\"r\":[[\"id3\",\"Gamma\",\"\",\"\",\"\",[],0,90,1000,3,20]]});");
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        });
        var client = new LibraryClient(new HttpClient(handler), "https://cdn.example/harmonica/");

        var catalog = await client.GetCatalogAsync();

        Assert.Equal(new[] { "id2", "id3", "id1" }, catalog.Select(entry => entry.Id));
        Assert.DoesNotContain(handler.Requested, url => url.Contains("catalog/b"));
        Assert.All(handler.Requested, url => Assert.Contains("?t=", url));
        Assert.Equal("匿名玩家", catalog[2].Uploader);
        Assert.Equal(120, catalog[0].Bpm); // zero falls back like the web
        Assert.Empty(catalog[0].Tags);
    }

    [Fact]
    public async Task Decodes_a_public_score_payload()
    {
        var fixtureJson = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "scale.json"));
        using var fixture = System.Text.Json.JsonDocument.Parse(fixtureJson);
        var payload = fixture.RootElement.GetProperty("snapshotBase64Url").GetString();
        var handler = new StubHandler(_ => Text($"__dfh(\"score/abcdef12\", {{\"i\":\"abcdef12\",\"t\":\"音阶\",\"c\":\"\",\"u\":\"某人\",\"a\":\"\",\"g\":[\"练习\"],\"d\":1,\"b\":143,\"l\":6210,\"n\":15,\"m\":1,\"p\":\"{payload}\"}});"));
        var client = new LibraryClient(new HttpClient(handler), "https://cdn.example/harmonica");

        var score = await client.GetPublicScoreAsync("abcdef12");

        Assert.Equal("音阶", score.Entry.Title);
        Assert.Equal(15, score.Snapshot.Notes.Count);
        Assert.Equal(143, score.Snapshot.Bpm);
        await Assert.ThrowsAsync<LibraryException>(() => client.GetPublicScoreAsync("bad id"));
    }

    [Fact]
    public void Search_matches_title_composer_uploader_and_tags()
    {
        var entries = new List<LibraryEntry>
        {
            new("1", "小星星", "", "Alice", "", ["儿歌"], 0, 120, 0, 0, 0),
            new("2", "Canon", "Pachelbel", "Bob", "", ["古典", "慢"], 0, 120, 0, 0, 0)
        };

        Assert.Equal(["1"], LibraryClient.Search(entries, "星").Select(entry => entry.Id));
        Assert.Equal(["2"], LibraryClient.Search(entries, "pach").Select(entry => entry.Id));
        Assert.Equal(["1"], LibraryClient.Search(entries, "alice").Select(entry => entry.Id));
        Assert.Equal(["2"], LibraryClient.Search(entries, "", ["古典"]).Select(entry => entry.Id));
        Assert.Equal(2, LibraryClient.Search(entries, "   ").Count);
    }
}
