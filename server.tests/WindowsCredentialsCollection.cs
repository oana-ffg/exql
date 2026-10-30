using Xunit;

namespace Exql.Server.Tests;

// Parallel CredWrite calls from separate test classes intermittently lose vault entries.
[CollectionDefinition("Windows credentials", DisableParallelization = true)]
public sealed class WindowsCredentialsCollection;
