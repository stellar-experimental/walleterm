//! Canonical XDR and StrKey helpers shared by every signing path.

use base64::Engine as _;
use base64::engine::DecodePaddingMode;
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig, STANDARD};
use stellar_strkey::{Contract, ed25519};
use stellar_xdr::{Limits, ReadXdr, WriteXdr};

/// Decoder recursion limit, equal to the Soroban host's XDR depth limit. A deeper value cannot run on chain.
/// It bounds stack use: a release build needs under 256 KiB at this depth, a debug build about 1 MiB.
/// The authorization checks apply the semantic 32-level invocation limit separately.
pub const XDR_DEPTH: u32 = 500;

#[derive(Debug, PartialEq, Eq)]
pub enum Decode {
    /// Not Base64, not the requested XDR type, or trailing bytes.
    Invalid,
    /// Valid XDR whose encoding differs from its canonical Base64 form.
    NonCanonical,
}

/// Node's Base64 decoder accepts whitespace, missing padding, nonzero trailing bits, and the URL alphabet.
/// Use it only to tell a noncanonical alias from invalid input.
const LENIENT: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

fn limits(len: usize) -> Limits {
    Limits { depth: XDR_DEPTH, len }
}

/// Decode canonical Base64 XDR that the whole buffer encodes exactly.
pub fn decode<T: ReadXdr + WriteXdr>(encoded: &str) -> Result<T, Decode> {
    if let Ok(bytes) = STANDARD.decode(encoded) {
        let value = T::from_xdr(&bytes, limits(bytes.len())).map_err(|_| Decode::Invalid)?;
        return match value.to_xdr(limits(bytes.len())) {
            Ok(again) if again == bytes => Ok(value),
            _ => Err(Decode::NonCanonical),
        };
    }
    let compact: String = encoded
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            c => c,
        })
        .collect();
    match LENIENT.decode(compact) {
        Ok(bytes) if T::from_xdr(&bytes, limits(bytes.len())).is_ok() => Err(Decode::NonCanonical),
        _ => Err(Decode::Invalid),
    }
}

/// Canonical Base64 for a value that this program built or already decoded.
pub fn encode<T: WriteXdr>(value: &T) -> String {
    let bytes = value.to_xdr(Limits::none()).expect("an in-memory XDR value always encodes");
    STANDARD.encode(bytes)
}

pub fn xdr_bytes<T: WriteXdr>(value: &T) -> Vec<u8> {
    value.to_xdr(Limits::none()).expect("an in-memory XDR value always encodes")
}

/// The raw key of a canonical Ed25519 G-address.
pub fn account_key(address: &str) -> Option<[u8; 32]> {
    let key = ed25519::PublicKey::from_string(address).ok()?;
    (key.to_string() == address).then_some(key.0)
}

pub fn account_address(key: &[u8; 32]) -> String {
    ed25519::PublicKey(*key).to_string()
}

pub fn is_contract(address: &str) -> bool {
    Contract::from_string(address).is_ok_and(|c| c.to_string() == address)
}

pub fn contract_id(address: &str) -> Option<[u8; 32]> {
    let contract = Contract::from_string(address).ok()?;
    (contract.to_string() == address).then_some(contract.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::{
        ContractId, Hash, InvokeContractArgs, ScAddress, ScSymbol, ScVal, ScVec, SorobanAuthorizedFunction,
        SorobanAuthorizedInvocation,
    };

    fn call(children: Vec<SorobanAuthorizedInvocation>, arg: ScVal) -> SorobanAuthorizedInvocation {
        SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address: ScAddress::Contract(ContractId(Hash([2; 32]))),
                function_name: ScSymbol("f".try_into().unwrap()),
                args: vec![arg].try_into().unwrap(),
            }),
            sub_invocations: children.try_into().unwrap(),
        }
    }

    fn nested_value(levels: usize) -> ScVal {
        (0..levels).fold(ScVal::U32(1), |v, _| ScVal::Vec(Some(ScVec(vec![v].try_into().unwrap()))))
    }

    fn chain(levels: usize, arg: &ScVal) -> SorobanAuthorizedInvocation {
        (1..levels).fold(call(vec![], arg.clone()), |child, _| call(vec![child], arg.clone()))
    }

    #[test]
    fn decode_rejects_aliases_and_trailing_bytes() {
        let value = call(vec![], ScVal::U32(7));
        let text = encode(&value);
        assert_eq!(decode::<SorobanAuthorizedInvocation>(&text), Ok(value.clone()));
        let spaced = format!("{} {}", &text[..4], &text[4..]);
        assert_eq!(decode::<SorobanAuthorizedInvocation>(&spaced), Err(Decode::NonCanonical));
        let url = text.replace('+', "-").replace('/', "_");
        if url != text {
            assert_eq!(decode::<SorobanAuthorizedInvocation>(&url), Err(Decode::NonCanonical));
        }
        let mut bytes = xdr_bytes(&value);
        bytes.extend([0, 0, 0, 0]);
        assert_eq!(decode::<SorobanAuthorizedInvocation>(&STANDARD.encode(bytes)), Err(Decode::Invalid));
        assert_eq!(decode::<SorobanAuthorizedInvocation>("!!!"), Err(Decode::Invalid));
        assert_eq!(decode::<SorobanAuthorizedInvocation>(""), Err(Decode::Invalid));
    }

    #[test]
    fn decode_rejects_noncanonical_padding_bytes() {
        // A symbol of length 1 carries three padding bytes that must be zero.
        let value = ScVal::Symbol(ScSymbol("a".try_into().unwrap()));
        let mut bytes = xdr_bytes(&value);
        let last = bytes.len() - 1;
        bytes[last] = 1;
        assert!(decode::<ScVal>(&STANDARD.encode(bytes)).is_err());
    }

    /// Tokio worker threads default to 2 MiB. Test at that size in the slower debug build.
    fn on_small_stack(test: impl FnOnce() + Send + 'static) {
        std::thread::Builder::new().stack_size(2 << 20).spawn(test).unwrap().join().unwrap();
    }

    #[test]
    fn depth_limit_accepts_the_semantic_maximum_with_deep_arguments() {
        // 32 invocation levels, each with a 40-level argument.
        let text = encode(&chain(32, &nested_value(40)));
        on_small_stack(move || assert!(decode::<SorobanAuthorizedInvocation>(&text).is_ok()));
    }

    #[test]
    fn depth_limit_stops_hostile_nesting_without_overflow() {
        // 100,000 nested vectors, written as raw XDR so the test never builds the value.
        let mut bytes = [0, 0, 0, 16, 0, 0, 0, 1, 0, 0, 0, 1].repeat(100_000);
        bytes.extend([0, 0, 0, 3, 0, 0, 0, 1]);
        let text = STANDARD.encode(bytes);
        on_small_stack(move || assert_eq!(decode::<ScVal>(&text), Err(Decode::Invalid)));
    }

    #[test]
    fn strkeys_are_canonical() {
        let g = account_address(&[7; 32]);
        assert_eq!(account_key(&g), Some([7; 32]));
        assert_eq!(account_key(&g.to_lowercase()), None);
        assert_eq!(account_key(&g[..55]), None);
        let c = Contract([9; 32]).to_string();
        assert!(is_contract(&c));
        assert!(!is_contract(&g));
        assert_eq!(account_key(&c), None);
        assert_eq!(contract_id(&c), Some([9; 32]));
        // A final character with nonzero unused bits decodes in some libraries. It is not canonical.
        let mut alias = g.clone().into_bytes();
        let last = alias.len() - 1;
        alias[last] = if alias[last] == b'A' { b'B' } else { b'A' };
        assert_eq!(account_key(std::str::from_utf8(&alias).unwrap()), None);
    }
}
