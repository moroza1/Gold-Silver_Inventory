namespace PMIMS.Domain;

public enum OwnershipType
{
    KFH_OWNED,
    CUSTOMER_OWNED,
    TURKEY_OWNED
}

public enum LocationType
{
    MAIN_VAULT,
    BRANCH,
    CUSTOMER,
    SUPPLIER,
    GDM
}

public enum TransactionType
{
    RECEIPT,
    TRANSFER,
    SALE,
    PURCHASE,
    REDEMPTION,
    DISPATCH,
    ADJUSTMENT
}

public enum WorkItemStatus
{
    PENDING_MAKER,
    PENDING_CHECKER,
    RETURNED,
    APPROVED,
    REJECTED
}
