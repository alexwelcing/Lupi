import Foundation

// The subset of the Firestore REST v1 surface the trophy sync uses, typed:
// Document, Write (+ Precondition, FieldTransform), WriteResult, a
// StructuredQuery with one field filter, ordering and a start cursor.
// Shapes follow firebase.google.com/docs/firestore/reference/rest/v1. Every
// type is Codable both ways so the in-memory fake can read what the client
// sends.

public struct FirestoreDocument: Codable, Sendable, Equatable {
  /// projects/{p}/databases/{d}/documents/{path}
  public var name: String
  public var fields: [String: FirestoreValue]
  public var createTime: FirestoreTimestamp?
  public var updateTime: FirestoreTimestamp?

  public init(
    name: String,
    fields: [String: FirestoreValue],
    createTime: FirestoreTimestamp? = nil,
    updateTime: FirestoreTimestamp? = nil
  ) {
    self.name = name
    self.fields = fields
    self.createTime = createTime
    self.updateTime = updateTime
  }

  /// The last path segment.
  public var documentID: String {
    name.split(separator: "/").last.map(String.init) ?? name
  }

  private enum CodingKeys: String, CodingKey { case name, fields, createTime, updateTime }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    name = try container.decode(String.self, forKey: .name)
    // A document with no fields arrives without the key.
    fields = try container.decodeIfPresent([String: FirestoreValue].self, forKey: .fields) ?? [:]
    createTime = try container.decodeIfPresent(FirestoreTimestamp.self, forKey: .createTime)
    updateTime = try container.decodeIfPresent(FirestoreTimestamp.self, forKey: .updateTime)
  }
}

public enum Precondition: Codable, Sendable, Equatable {
  /// true: must exist; false: must not exist.
  case exists(Bool)
  /// Must exist and have been last updated at exactly this time.
  case updateTime(FirestoreTimestamp)

  private enum CodingKeys: String, CodingKey { case exists, updateTime }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let exists = try container.decodeIfPresent(Bool.self, forKey: .exists) {
      self = .exists(exists)
    } else {
      self = .updateTime(try container.decode(FirestoreTimestamp.self, forKey: .updateTime))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .exists(let exists): try container.encode(exists, forKey: .exists)
    case .updateTime(let time): try container.encode(time, forKey: .updateTime)
    }
  }
}

public struct FieldTransform: Codable, Sendable, Equatable {
  public var fieldPath: String
  /// Only "REQUEST_TIME" exists today.
  public var setToServerValue: String

  public static func requestTime(_ fieldPath: String) -> FieldTransform {
    FieldTransform(fieldPath: fieldPath, setToServerValue: "REQUEST_TIME")
  }
}

public struct FirestoreWrite: Codable, Sendable, Equatable {
  public struct UpdateDocument: Codable, Sendable, Equatable {
    public var name: String
    public var fields: [String: FirestoreValue]
  }

  public var update: UpdateDocument?
  /// The full document name to delete.
  public var delete: String?
  public var updateTransforms: [FieldTransform]?
  public var currentDocument: Precondition?

  /// Replaces the whole document (no updateMask), then applies transforms.
  public static func set(
    name: String,
    fields: [String: FirestoreValue],
    serverTimestamps: [String] = [],
    precondition: Precondition? = nil
  ) -> FirestoreWrite {
    FirestoreWrite(
      update: UpdateDocument(name: name, fields: fields),
      delete: nil,
      updateTransforms: serverTimestamps.isEmpty ? nil : serverTimestamps.map(FieldTransform.requestTime),
      currentDocument: precondition
    )
  }

  public static func delete(name: String, precondition: Precondition? = nil) -> FirestoreWrite {
    FirestoreWrite(update: nil, delete: name, updateTransforms: nil, currentDocument: precondition)
  }

  /// The document this write targets.
  public var documentName: String { update?.name ?? delete ?? "" }
}

public struct WriteResult: Codable, Sendable, Equatable {
  public var updateTime: FirestoreTimestamp?
  /// One value per update transform, in order.
  public var transformResults: [FirestoreValue]?

  public init(updateTime: FirestoreTimestamp?, transformResults: [FirestoreValue]? = nil) {
    self.updateTime = updateTime
    self.transformResults = transformResults
  }
}

public struct CommitResponse: Codable, Sendable, Equatable {
  public var writeResults: [WriteResult]?
  public var commitTime: FirestoreTimestamp?

  public init(writeResults: [WriteResult]?, commitTime: FirestoreTimestamp?) {
    self.writeResults = writeResults
    self.commitTime = commitTime
  }
}

public struct StructuredQuery: Codable, Sendable, Equatable {
  public struct CollectionSelector: Codable, Sendable, Equatable {
    public var collectionId: String
    public var allDescendants: Bool?
  }

  public struct FieldReference: Codable, Sendable, Equatable {
    public var fieldPath: String
  }

  public struct FieldFilter: Codable, Sendable, Equatable {
    public var field: FieldReference
    /// e.g. "GREATER_THAN".
    public var op: String
    public var value: FirestoreValue
  }

  public struct Filter: Codable, Sendable, Equatable {
    public var fieldFilter: FieldFilter?
  }

  public struct Order: Codable, Sendable, Equatable {
    public var field: FieldReference
    /// "ASCENDING" or "DESCENDING".
    public var direction: String
  }

  public struct Cursor: Codable, Sendable, Equatable {
    public var values: [FirestoreValue]
    /// true: just before the position; false: just after it.
    public var before: Bool?
  }

  public var from: [CollectionSelector]
  public var `where`: Filter?
  public var orderBy: [Order]?
  public var startAt: Cursor?
  public var limit: Int?

  public init(
    from: [CollectionSelector],
    where filter: Filter? = nil,
    orderBy: [Order]? = nil,
    startAt: Cursor? = nil,
    limit: Int? = nil
  ) {
    self.from = from
    self.where = filter
    self.orderBy = orderBy
    self.startAt = startAt
    self.limit = limit
  }

  /// Documents of `collection` whose `field` is after `since`, in (field,
  /// __name__) order, resuming strictly after `after` when paging. Ordering
  /// by __name__ as well makes the order total, so documents sharing a server
  /// timestamp (one commit stamps all its writes alike) are never skipped at
  /// a page boundary.
  public static func changes(
    in collection: String,
    field: String,
    since: FirestoreTimestamp?,
    after: (FirestoreTimestamp, String)?,
    limit: Int
  ) -> StructuredQuery {
    StructuredQuery(
      from: [CollectionSelector(collectionId: collection, allDescendants: false)],
      where: since.map {
        Filter(fieldFilter: FieldFilter(field: FieldReference(fieldPath: field), op: "GREATER_THAN", value: .timestamp($0)))
      },
      orderBy: [
        Order(field: FieldReference(fieldPath: field), direction: "ASCENDING"),
        Order(field: FieldReference(fieldPath: "__name__"), direction: "ASCENDING"),
      ],
      startAt: after.map { Cursor(values: [.timestamp($0.0), .reference($0.1)], before: false) },
      limit: limit
    )
  }
}

/// One element of runQuery's streamed JSON array.
public struct RunQueryResponseElement: Codable, Sendable, Equatable {
  public var document: FirestoreDocument?
  public var readTime: FirestoreTimestamp?
  public var skippedResults: Int?
  public var done: Bool?

  public init(document: FirestoreDocument? = nil, readTime: FirestoreTimestamp? = nil) {
    self.document = document
    self.readTime = readTime
  }
}

public struct ListDocumentsResponse: Codable, Sendable, Equatable {
  public var documents: [FirestoreDocument]?
  public var nextPageToken: String?

  public init(documents: [FirestoreDocument]?, nextPageToken: String?) {
    self.documents = documents
    self.nextPageToken = nextPageToken
  }
}
