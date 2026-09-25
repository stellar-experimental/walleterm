#[soroban_sdk::contractargs(name = "Args")]
#[soroban_sdk::contractclient(name = "Client")]
pub trait Contract {
    fn execute(
        env: soroban_sdk::Env,
        target: soroban_sdk::Address,
        target_fn: soroban_sdk::Symbol,
        target_args: soroban_sdk::Vec<soroban_sdk::Val>,
    );
    fn upgrade(
        env: soroban_sdk::Env,
        new_wasm_hash: soroban_sdk::BytesN<32>,
        operator: soroban_sdk::Address,
    );
    fn add_policy(
        env: soroban_sdk::Env,
        context_rule_id: u32,
        policy: soroban_sdk::Address,
        install_param: soroban_sdk::Val,
    ) -> u32;
    fn add_signer(env: soroban_sdk::Env, context_rule_id: u32, signer: Signer) -> u32;
    fn __check_auth(
        env: soroban_sdk::Env,
        signature_payload: soroban_sdk::BytesN<32>,
        signatures: AuthPayload,
        auth_contexts: soroban_sdk::Vec<Context>,
    ) -> Result<(), SmartAccountError>;
    fn __constructor(
        env: soroban_sdk::Env,
        signers: soroban_sdk::Vec<Signer>,
        policies: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val>,
    );
    fn get_policy_id(env: soroban_sdk::Env, policy: soroban_sdk::Address) -> u32;
    fn get_signer_id(env: soroban_sdk::Env, signer: Signer) -> u32;
    fn remove_policy(env: soroban_sdk::Env, context_rule_id: u32, policy_id: u32);
    fn remove_signer(env: soroban_sdk::Env, context_rule_id: u32, signer_id: u32);
    fn add_context_rule(
        env: soroban_sdk::Env,
        context_type: ContextRuleType,
        name: soroban_sdk::String,
        valid_until: Option<u32>,
        signers: soroban_sdk::Vec<Signer>,
        policies: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val>,
    ) -> ContextRule;
    fn batch_add_signer(
        env: soroban_sdk::Env,
        context_rule_id: u32,
        signers: soroban_sdk::Vec<Signer>,
    );
    fn get_context_rule(env: soroban_sdk::Env, context_rule_id: u32) -> ContextRule;
    fn remove_context_rule(env: soroban_sdk::Env, context_rule_id: u32);
    fn get_context_rules_count(env: soroban_sdk::Env) -> u32;
    fn update_context_rule_name(
        env: soroban_sdk::Env,
        context_rule_id: u32,
        name: soroban_sdk::String,
    ) -> ContextRule;
    fn update_context_rule_valid_until(
        env: soroban_sdk::Env,
        context_rule_id: u32,
        valid_until: Option<u32>,
    ) -> ContextRule;
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ContractContext {
    pub args: soroban_sdk::Vec<soroban_sdk::Val>,
    pub contract: soroban_sdk::Address,
    pub fn_name: soroban_sdk::Symbol,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct CreateContractHostFnContext {
    pub executable: ContractExecutable,
    pub salt: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct CreateContractWithConstructorHostFnContext {
    pub constructor_args: soroban_sdk::Vec<soroban_sdk::Val>,
    pub executable: ContractExecutable,
    pub salt: soroban_sdk::BytesN<32>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct AuthPayload {
    pub context_rule_ids: soroban_sdk::Vec<u32>,
    pub signers: soroban_sdk::Map<Signer, soroban_sdk::Bytes>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ContextRule {
    pub context_type: ContextRuleType,
    pub id: u32,
    pub name: soroban_sdk::String,
    pub policies: soroban_sdk::Vec<soroban_sdk::Address>,
    pub policy_ids: soroban_sdk::Vec<u32>,
    pub signer_ids: soroban_sdk::Vec<u32>,
    pub signers: soroban_sdk::Vec<Signer>,
    pub valid_until: Option<u32>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Context {
    Contract(ContractContext),
    CreateContractHostFn(CreateContractHostFnContext),
    CreateContractWithCtorHostFn(CreateContractWithConstructorHostFnContext),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum ContractExecutable {
    Wasm(soroban_sdk::BytesN<32>),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Signer {
    Delegated(soroban_sdk::Address),
    External(soroban_sdk::Address, soroban_sdk::Bytes),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum ContextRuleType {
    Default,
    CallContract(soroban_sdk::Address),
    CreateContract(soroban_sdk::BytesN<32>),
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SmartAccountError {
    ContextRuleNotFound = 3000,
    UnvalidatedContext = 3002,
    ExternalVerificationFailed = 3003,
    NoSignersAndPolicies = 3004,
    PastValidUntil = 3005,
    SignerNotFound = 3006,
    DuplicateSigner = 3007,
    PolicyNotFound = 3008,
    DuplicatePolicy = 3009,
    TooManySigners = 3010,
    TooManyPolicies = 3011,
    MathOverflow = 3012,
    KeyDataTooLarge = 3013,
    ContextRuleIdsLengthMismatch = 3014,
    NameTooLong = 3015,
    UnauthorizedSigner = 3016,
}
#[soroban_sdk::contractevent(export = false, topics = ["policy_added"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PolicyAdded {
    #[topic]
    pub context_rule_id: u32,
    pub policy_id: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["signer_added"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SignerAdded {
    #[topic]
    pub context_rule_id: u32,
    pub signer_id: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["policy_removed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PolicyRemoved {
    #[topic]
    pub context_rule_id: u32,
    pub policy_id: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["signer_removed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SignerRemoved {
    #[topic]
    pub context_rule_id: u32,
    pub signer_id: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["context_rule_added"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ContextRuleAdded {
    #[topic]
    pub context_rule_id: u32,
    pub name: soroban_sdk::String,
    pub context_type: ContextRuleType,
    pub valid_until: Option<u32>,
    pub signer_ids: soroban_sdk::Vec<u32>,
    pub policy_ids: soroban_sdk::Vec<u32>,
}
#[soroban_sdk::contractevent(export = false, topics = ["policy_registered"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PolicyRegistered {
    #[topic]
    pub policy_id: u32,
    pub policy: soroban_sdk::Address,
}
#[soroban_sdk::contractevent(export = false, topics = ["signer_registered"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SignerRegistered {
    #[topic]
    pub signer_id: u32,
    pub signer: Signer,
}
#[soroban_sdk::contractevent(export = false, topics = ["context_rule_removed"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ContextRuleRemoved {
    #[topic]
    pub context_rule_id: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["policy_deregistered"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PolicyDeregistered {
    #[topic]
    pub policy_id: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["signer_deregistered"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SignerDeregistered {
    #[topic]
    pub signer_id: u32,
}
#[soroban_sdk::contractevent(export = false, topics = ["context_rule_meta_updated"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ContextRuleMetaUpdated {
    #[topic]
    pub context_rule_id: u32,
    pub name: soroban_sdk::String,
    pub valid_until: Option<u32>,
}

