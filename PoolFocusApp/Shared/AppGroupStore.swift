import Foundation

struct AppGroupStore {
    private let defaults: UserDefaults

    init?(suiteName: String = PoolFocusConstants.appGroupIdentifier) {
        #if POOLFOCUS_DEMO
        self.defaults = .standard
        #else
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            return nil
        }
        self.defaults = defaults
        #endif
    }

    func data(forKey key: String) -> Data? {
        defaults.data(forKey: key)
    }

    func set(_ data: Data?, forKey key: String) {
        defaults.set(data, forKey: key)
        defaults.synchronize()
    }

    func string(forKey key: String) -> String? {
        defaults.string(forKey: key)
    }

    func set(_ value: String?, forKey key: String) {
        defaults.set(value, forKey: key)
        defaults.synchronize()
    }

    func date(forKey key: String) -> Date? {
        defaults.object(forKey: key) as? Date
    }

    func set(_ value: Date?, forKey key: String) {
        defaults.set(value, forKey: key)
        defaults.synchronize()
    }

    func integer(forKey key: String) -> Int {
        defaults.integer(forKey: key)
    }

    func set(_ value: Int, forKey key: String) {
        defaults.set(value, forKey: key)
        defaults.synchronize()
    }

    func codable<T: Codable>(_ type: T.Type, forKey key: String) -> T? {
        guard let data = data(forKey: key) else {
            return nil
        }
        return try? JSONDecoder.poolFocus.decode(type, from: data)
    }

    func setCodable<T: Codable>(_ value: T?, forKey key: String) {
        guard let value else {
            set(nil as Data?, forKey: key)
            return
        }
        let data = try? JSONEncoder.poolFocus.encode(value)
        set(data, forKey: key)
    }
}

extension JSONEncoder {
    static var poolFocus: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

extension JSONDecoder {
    static var poolFocus: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
