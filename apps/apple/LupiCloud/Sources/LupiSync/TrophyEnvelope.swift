import Foundation

/// The Firestore document that carries one record at
/// users/{uid}/{collection}/{id}. firestore.rules checks exactly these keys:
///
///   schema           string     "lupi.trophy.v1"
///   id               string     == the document id
///   payload          map        the record; {} for a tombstone
///   deleted          bool       tombstone flag
///   updatedAt        timestamp  server REQUEST_TIME, set by a transform
///   clientUpdatedAt  timestamp  when the owner made the change (device clock)
public enum TrophyEnvelope {
  public static let schema = "schema"
  public static let id = "id"
  public static let payload = "payload"
  public static let deleted = "deleted"
  public static let updatedAt = "updatedAt"
  public static let clientUpdatedAt = "clientUpdatedAt"

  /// Fields for a write. updatedAt is left to the server transform.
  static func fields(
    schema: String,
    id: String,
    payload: [String: FirestoreValue]?,
    clientUpdatedAt: FirestoreTimestamp
  ) -> [String: FirestoreValue] {
    [
      Self.schema: .string(schema),
      Self.id: .string(id),
      Self.payload: .map(payload ?? [:]),
      Self.deleted: .boolean(payload == nil),
      Self.clientUpdatedAt: .timestamp(clientUpdatedAt),
    ]
  }

  struct Decoded<Payload: SyncPayload> {
    var id: String
    var payload: Payload?
    var clientUpdatedAt: FirestoreTimestamp
    var version: RemoteVersion
  }

  /// Reads a document back; returns a reason instead when this build cannot
  /// use it (another schema, a payload that does not decode).
  static func decode<Payload: SyncPayload>(
    _ document: FirestoreDocument,
    schema expected: String,
    as type: Payload.Type
  ) -> Result<Decoded<Payload>, EnvelopeProblem> {
    let fields = document.fields
    guard fields[schema]?.stringValue == expected else {
      return .failure(EnvelopeProblem(id: document.documentID, reason: "schema \(fields[schema]?.stringValue ?? "missing")"))
    }
    guard let id = fields[Self.id]?.stringValue, id == document.documentID,
      let deleted = fields[Self.deleted]?.booleanValue,
      let clientUpdatedAt = fields[Self.clientUpdatedAt]?.timestampValue,
      let updatedAt = fields[Self.updatedAt]?.timestampValue,
      let updateTime = document.updateTime,
      let payloadFields = fields[Self.payload]?.mapFields
    else {
      return .failure(EnvelopeProblem(id: document.documentID, reason: "malformed envelope"))
    }
    var payload: Payload?
    if !deleted {
      do {
        payload = try FirestoreDecoder().decode(Payload.self, fields: payloadFields)
      } catch {
        return .failure(EnvelopeProblem(id: id, reason: "payload: \(error)"))
      }
      if payload?.id != id {
        return .failure(EnvelopeProblem(id: id, reason: "payload id differs from document id"))
      }
    }
    return .success(
      Decoded(
        id: id,
        payload: payload,
        clientUpdatedAt: clientUpdatedAt,
        version: RemoteVersion(updateTime: updateTime, updatedAt: updatedAt)
      )
    )
  }
}

struct EnvelopeProblem: Error {
  var id: String
  var reason: String
}
