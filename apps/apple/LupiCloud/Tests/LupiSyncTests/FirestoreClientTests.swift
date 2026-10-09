import Foundation
import LupiCloudTesting
import Testing

@testable import LupiSync

/// Hands out "token-1", "token-2", … and counts forced refreshes.
actor CountingTokens: AccessTokenProvider {
  private(set) var forced = 0
  private var current = 1

  func accessToken(forceRefresh: Bool) async throws -> String {
    if forceRefresh {
      forced += 1
      current += 1
    }
    return "token-\(current)"
  }
}

@Suite("Firestore REST requests")
struct FirestoreClientTests {
  let config = FirestoreConfiguration(projectID: "demo-lupi")

  @Test("get: path, bearer token, and nil on 404")
  func get() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(
      .json(200, #"{"name":"projects/demo-lupi/databases/(default)/documents/users/u1/trophies/t1","fields":{},"updateTime":"2026-10-04T21:45:51Z"}"#),
      .googleError(404, message: "Document not found.", rpcStatus: "NOT_FOUND")
    )
    let client = FirestoreClient(configuration: config, transport: transport, tokens: CountingTokens())
    let document = try await client.getDocument("users/u1/trophies/t1")
    #expect(document?.documentID == "t1")
    #expect(try await client.getDocument("users/u1/trophies/t2") == nil)
    let request = try #require(await transport.requests.first)
    #expect(request.method == "GET")
    #expect(request.url.absoluteString == "https://firestore.googleapis.com/v1/projects/demo-lupi/databases/(default)/documents/users/u1/trophies/t1")
    #expect(request.headers["Authorization"] == "Bearer token-1")
    #expect(request.body == nil)
  }

  @Test("list: page size, token and field mask as query parameters")
  func list() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(200, #"{"documents":[{"name":"projects/demo-lupi/databases/(default)/documents/users/u1/trophies/a"}],"nextPageToken":"n1"}"#))
    let client = FirestoreClient(configuration: config, transport: transport, tokens: CountingTokens())
    let page = try await client.listDocuments(collectionPath: "users/u1/trophies", pageSize: 50, pageToken: "p+1", mask: ["deleted"])
    #expect(page.documents?.count == 1)
    #expect(page.nextPageToken == "n1")
    #expect(
      await transport.lastRequest?.url.absoluteString
        == "https://firestore.googleapis.com/v1/projects/demo-lupi/databases/(default)/documents/users/u1/trophies?pageSize=50&pageToken=p%2B1&mask.fieldPaths=deleted"
    )
  }

  @Test("runQuery: the incremental-pull query, verbatim")
  func runQuery() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(200, #"[{"readTime":"2026-10-04T21:45:52.5Z"}]"#))
    let client = FirestoreClient(configuration: config, transport: transport, tokens: CountingTokens())
    let since = FirestoreTimestamp(rfc3339: "2026-10-04T21:44:51Z")!
    let after = (FirestoreTimestamp(rfc3339: "2026-10-04T21:45:51.001Z")!, "projects/demo-lupi/databases/(default)/documents/users/u1/trophies/t9")
    let result = try await client.runQuery(
      parentPath: "users/u1",
      .changes(in: "trophies", field: "updatedAt", since: since, after: after, limit: 300)
    )
    #expect(result.documents.isEmpty)
    #expect(result.readTime == FirestoreTimestamp(rfc3339: "2026-10-04T21:45:52.5Z"))
    let request = try #require(await transport.lastRequest)
    #expect(request.method == "POST")
    #expect(request.url.absoluteString == "https://firestore.googleapis.com/v1/projects/demo-lupi/databases/(default)/documents/users/u1:runQuery")
    #expect(request.headers["Content-Type"] == "application/json")
    #expect(
      request.bodyText
        == #"{"structuredQuery":{"from":[{"allDescendants":false,"collectionId":"trophies"}],"limit":300,"orderBy":[{"direction":"ASCENDING","field":{"fieldPath":"updatedAt"}},{"direction":"ASCENDING","field":{"fieldPath":"__name__"}}],"startAt":{"before":false,"values":[{"timestampValue":"2026-10-04T21:45:51.001Z"},{"referenceValue":"projects/demo-lupi/databases/(default)/documents/users/u1/trophies/t9"}]},"where":{"fieldFilter":{"field":{"fieldPath":"updatedAt"},"op":"GREATER_THAN","value":{"timestampValue":"2026-10-04T21:44:51Z"}}}}}"#
    )
  }

  @Test("commit: set with REQUEST_TIME transform and preconditions, delete")
  func commit() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(.json(
      200,
      #"{"writeResults":[{"updateTime":"2026-10-04T21:45:53Z","transformResults":[{"timestampValue":"2026-10-04T21:45:53Z"}]},{"updateTime":"2026-10-04T21:45:53Z"}],"commitTime":"2026-10-04T21:45:53Z"}"#
    ))
    let client = FirestoreClient(configuration: config, transport: transport, tokens: CountingTokens())
    let name = config.documentName("users/u1/trophies/t1")
    let response = try await client.commit([
      .set(name: name, fields: ["deleted": .boolean(false)], serverTimestamps: ["updatedAt"], precondition: .exists(false)),
      .delete(name: config.documentName("users/u1/trophies/t2"), precondition: .updateTime(FirestoreTimestamp(seconds: 1_791_150_351, nanos: 1000))),
    ])
    #expect(response.writeResults?.count == 2)
    #expect(response.writeResults?.first?.transformResults?.first?.timestampValue == FirestoreTimestamp(seconds: 1_791_150_353))
    let request = try #require(await transport.lastRequest)
    #expect(request.url.absoluteString == "https://firestore.googleapis.com/v1/projects/demo-lupi/databases/(default)/documents:commit")
    #expect(
      request.bodyText
        == #"{"writes":[{"currentDocument":{"exists":false},"update":{"fields":{"deleted":{"booleanValue":false}},"name":"projects/demo-lupi/databases/(default)/documents/users/u1/trophies/t1"},"updateTransforms":[{"fieldPath":"updatedAt","setToServerValue":"REQUEST_TIME"}]},{"currentDocument":{"updateTime":"2026-10-04T21:45:51.000001Z"},"delete":"projects/demo-lupi/databases/(default)/documents/users/u1/trophies/t2"}]}"#
    )
  }

  @Test("401 refreshes the token once and retries")
  func unauthorizedRetry() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(
      .googleError(401, message: "Request had invalid authentication credentials.", rpcStatus: "UNAUTHENTICATED"),
      .json(200, "[]")
    )
    let tokens = CountingTokens()
    let client = FirestoreClient(configuration: config, transport: transport, tokens: tokens)
    _ = try await client.runQuery(parentPath: "users/u1", .changes(in: "trophies", field: "updatedAt", since: nil, after: nil, limit: 1))
    #expect(await tokens.forced == 1)
    #expect(await transport.requests.map { $0.headers["Authorization"] } == ["Bearer token-1", "Bearer token-2"])
  }

  @Test("errors carry the google.rpc status")
  func errors() async throws {
    let transport = ScriptedTransport()
    await transport.enqueue(
      .googleError(400, message: "the stored version does not match", rpcStatus: "FAILED_PRECONDITION"),
      .googleError(409, message: "Document already exists", rpcStatus: "ALREADY_EXISTS"),
      .googleError(403, message: "Missing or insufficient permissions.", rpcStatus: "PERMISSION_DENIED")
    )
    let client = FirestoreClient(configuration: config, transport: transport, tokens: CountingTokens())
    for expectation in [(true, false), (true, false), (false, true)] {
      do {
        _ = try await client.commit([])
        Issue.record("expected an error")
      } catch let error as FirestoreError {
        #expect(error.isPreconditionFailure == expectation.0)
        #expect(error.isRejection == expectation.1)
      }
    }
  }
}
