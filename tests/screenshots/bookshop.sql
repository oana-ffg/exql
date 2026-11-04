-- Fictional data for the README screenshots. People, books and addresses are invented.
EXEC(N'CREATE SCHEMA ref');
GO
CREATE TABLE ref.Countries (
    Code char(2) CONSTRAINT PK_Countries PRIMARY KEY,
    Name nvarchar(60) NOT NULL
);
INSERT ref.Countries(Code, Name) VALUES
  ('DK', N'Denmark'), ('SE', N'Sweden'), ('NO', N'Norway'), ('DE', N'Germany'), ('RO', N'Romania');

CREATE TABLE dbo.Customers (
    Id int IDENTITY(1,1) CONSTRAINT PK_Customers PRIMARY KEY,
    Name nvarchar(100) NOT NULL,
    Email nvarchar(200) NOT NULL,
    Country char(2) NOT NULL CONSTRAINT FK_Customers_Countries REFERENCES ref.Countries(Code),
    JoinedOn date NOT NULL
);
INSERT dbo.Customers(Name, Email, Country, JoinedOn) VALUES
  (N'Freja Holm', N'freja.holm@example.com', 'DK', '2024-02-11'),
  (N'Elsa Lindqvist', N'elsa.lindqvist@example.com', 'SE', '2024-03-02'),
  (N'Ingrid Dahl', N'ingrid.dahl@example.com', 'NO', '2024-05-19'),
  (N'Jonas Weber', N'jonas.weber@example.com', 'DE', '2024-06-27'),
  (N'Ioana Marin', N'ioana.marin@example.com', 'RO', '2024-08-14'),
  (N'Magnus Bech', N'magnus.bech@example.com', 'DK', '2024-11-03'),
  (N'Astrid Nyberg', N'astrid.nyberg@example.com', 'SE', '2025-01-22'),
  (N'Leon Fischer', N'leon.fischer@example.com', 'DE', '2025-04-09');

CREATE TABLE dbo.Books (
    Id int IDENTITY(1,1) CONSTRAINT PK_Books PRIMARY KEY,
    Title nvarchar(120) NOT NULL,
    Author nvarchar(100) NOT NULL,
    Genre nvarchar(40) NOT NULL,
    Price decimal(8,2) NOT NULL,
    InStock int NOT NULL
);
INSERT dbo.Books(Title, Author, Genre, Price, InStock) VALUES
  (N'The Salt Lighthouse', N'Maren Oakes', N'Mystery', 14.50, 32),
  (N'Northern Cartography', N'Tobias Rook', N'Travel', 22.00, 12),
  (N'A Field Guide to Quiet', N'Hanne Vale', N'Essays', 17.25, 48),
  (N'Rust and Rivers', N'Tobias Rook', N'Fiction', 16.00, 0),
  (N'Index Scan Blues', N'Dana Quill', N'Technology', 39.90, 21),
  (N'The Winter Orchard', N'Maren Oakes', N'Fiction', 15.75, 7);

CREATE TABLE dbo.Orders (
    Id int IDENTITY(1001,1) CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId int NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES dbo.Customers(Id),
    BookId int NOT NULL CONSTRAINT FK_Orders_Books REFERENCES dbo.Books(Id),
    Total decimal(10,2) NOT NULL,
    Status nvarchar(20) NOT NULL,
    OrderedOn date NOT NULL
);
INSERT dbo.Orders(CustomerId, BookId, Total, Status, OrderedOn) VALUES
  (1, 1, 14.50, N'Delivered', '2026-09-02'),
  (2, 3, 34.50, N'Delivered', '2026-09-03'),
  (5, 5, 39.90, N'Delivered', '2026-09-08'),
  (3, 2, 22.00, N'Shipped', '2026-09-11'),
  (4, 6, 47.25, N'Shipped', '2026-09-14'),
  (1, 5, 39.90, N'Shipped', '2026-09-18'),
  (6, 1, 29.00, N'Pending', '2026-09-21'),
  (7, 3, 17.25, N'Pending', '2026-09-22'),
  (8, 4, 16.00, N'Backordered', '2026-09-23'),
  (2, 6, 15.75, N'Pending', '2026-09-24'),
  (5, 2, 44.00, N'Pending', '2026-09-25'),
  (3, 5, 39.90, N'Cancelled', '2026-09-26');
GO
EXEC(N'CREATE VIEW dbo.OpenOrders AS SELECT Id, CustomerId, BookId, Total, Status FROM dbo.Orders WHERE Status IN (N''Pending'', N''Backordered'')');
