import Foundation

/// application/x-www-form-urlencoded bodies and query strings. Only RFC 3986
/// unreserved characters pass through, so '+', '&' and '=' inside a token
/// can never be misread as separators or spaces.
public enum FormEncoding {
  private static let unreserved: CharacterSet = {
    var set = CharacterSet()
    set.insert(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    return set
  }()

  public static func escape(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
  }

  /// `name=value&…` in the order given.
  public static func encode(_ pairs: [(String, String)]) -> String {
    pairs.map { "\(escape($0.0))=\(escape($0.1))" }.joined(separator: "&")
  }

  /// Parses a form body or query string; used by the fakes to read requests.
  public static func decode(_ text: String) -> [(String, String)] {
    text.split(separator: "&", omittingEmptySubsequences: true).map { part in
      let pieces = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      let name = String(pieces[0]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? ""
      let value = pieces.count > 1
        ? (String(pieces[1]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? "")
        : ""
      return (name, value)
    }
  }
}

extension URL {
  /// Appends a REST path such as "v1/accounts:lookup" verbatim. Google method
  /// paths carry a ':' that path-component APIs may escape.
  public func appendingAPIPath(_ path: String) -> URL {
    let base = absoluteString.hasSuffix("/") ? absoluteString : absoluteString + "/"
    let tail = path.hasPrefix("/") ? String(path.dropFirst()) : path
    return URL(string: base + tail) ?? self
  }

  /// Appends `?name=value&…` (or `&…` when a query exists), form-escaped.
  public func appendingQuery(_ pairs: [(String, String)]) -> URL {
    guard !pairs.isEmpty else { return self }
    let separator = absoluteString.contains("?") ? "&" : "?"
    return URL(string: absoluteString + separator + FormEncoding.encode(pairs)) ?? self
  }
}
