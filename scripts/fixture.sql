IF OBJECT_ID(N'dbo.WorkItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.WorkItems (
        Id int IDENTITY(1,1) CONSTRAINT PK_WorkItems PRIMARY KEY,
        Title nvarchar(200) NOT NULL,
        Status nvarchar(30) NOT NULL,
        Priority int NOT NULL,
        Estimate decimal(18,2) NULL,
        Active bit NOT NULL,
        Notes nvarchar(max) NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_WorkItems_CreatedAt DEFAULT SYSUTCDATETIME(),
        Version rowversion
    );
    INSERT dbo.WorkItems(Title, Status, Priority, Estimate, Active, Notes) VALUES
      (N'Build the data grid', N'In progress', 1, 12.50, 1, N'Test keyboard navigation and selection.'),
      (N'Query result export', N'Done', 2, 8.00, 1, N'CSV, JSON and exact decimal values.'),
      (N'Review connection settings', N'Open', 1, NULL, 1, NULL),
      (N'Unicode round trip — æøå 日本語', N'Open', 3, 3.75, 0, N'Comma, quote " and apostrophe '' preserved.'),
      (N'Empty versus NULL', N'Open', 2, 0, 1, N'');
    WITH numbers AS (SELECT TOP (240) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects)
    INSERT dbo.WorkItems(Title,Status,Priority,Estimate,Active,Notes)
    SELECT CONCAT(N'Pagination fixture ',n), N'Backlog', 4, n * 1.25, 0, NULL FROM numbers;
END;
IF OBJECT_ID(N'dbo.TypeSamples', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TypeSamples (
        Id int CONSTRAINT PK_TypeSamples PRIMARY KEY,
        LargeInteger bigint NOT NULL,
        ExactDecimal decimal(38,18) NOT NULL,
        EventTime datetimeoffset(7) NOT NULL,
        Payload varbinary(100) NULL,
        NullableText nvarchar(100) NULL,
        EmptyText nvarchar(100) NOT NULL,
        Derived AS (Id + 1)
    );
    INSERT dbo.TypeSamples(Id, LargeInteger, ExactDecimal, EventTime, Payload, NullableText, EmptyText)
    VALUES (1, 9223372036854775807, 12345678901234567890.123456789012345678, '2026-09-08T12:34:56.1234567+02:00', 0x00FF1080, NULL, N'');
END;
-- Additive fixtures also work when ExqlDemo was seeded before these tests.
IF COL_LENGTH(N'dbo.TypeSamples', N'LegacyDateTime') IS NULL
    ALTER TABLE dbo.TypeSamples ADD LegacyDateTime datetime NOT NULL
        CONSTRAINT DF_TypeSamples_LegacyDateTime DEFAULT '2026-09-08T12:34:56.123';
IF COL_LENGTH(N'dbo.TypeSamples', N'LegacyMinuteTime') IS NULL
    ALTER TABLE dbo.TypeSamples ADD LegacyMinuteTime smalldatetime NOT NULL
        CONSTRAINT DF_TypeSamples_LegacyMinuteTime DEFAULT '2026-09-08T12:34:00';
IF COL_LENGTH(N'dbo.TypeSamples', N'CalendarDate') IS NULL
    ALTER TABLE dbo.TypeSamples ADD CalendarDate date NOT NULL
        CONSTRAINT DF_TypeSamples_CalendarDate DEFAULT '2026-09-08';
IF COL_LENGTH(N'dbo.TypeSamples', N'ClockTime') IS NULL
    ALTER TABLE dbo.TypeSamples ADD ClockTime time(7) NOT NULL
        CONSTRAINT DF_TypeSamples_ClockTime DEFAULT '12:34:56.1234567';
IF COL_LENGTH(N'dbo.TypeSamples', N'Identifier') IS NULL
    ALTER TABLE dbo.TypeSamples ADD Identifier uniqueidentifier NOT NULL
        CONSTRAINT DF_TypeSamples_Identifier DEFAULT '01234567-89ab-cdef-0123-456789abcdef';
IF COL_LENGTH(N'dbo.TypeSamples', N'Amount') IS NULL
    ALTER TABLE dbo.TypeSamples ADD Amount money NOT NULL
        CONSTRAINT DF_TypeSamples_Amount DEFAULT 12.3456;
IF OBJECT_ID(N'dbo.NoPrimaryKey', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NoPrimaryKey (Value nvarchar(100) NULL);
    INSERT dbo.NoPrimaryKey(Value) VALUES (N'Read only without a primary key');
END;
IF OBJECT_ID(N'dbo.CommandLog', N'U') IS NULL
    CREATE TABLE dbo.CommandLog (Id int NOT NULL PRIMARY KEY, Message nvarchar(100) NULL);

GO
IF OBJECT_ID(N'dbo.OpenWorkItems', N'V') IS NULL
    EXEC(N'CREATE VIEW dbo.OpenWorkItems AS SELECT Id,Title,Status,Priority FROM dbo.WorkItems WHERE Status=N''Open''');
GO
