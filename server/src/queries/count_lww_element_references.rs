pub(crate) async fn count_lww_element_references_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
    value: &::std::vec::Vec<u8>,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    let query = "
        WITH latest_values AS (
            SELECT DISTINCT ON (
                events.system_key_type,
                events.system_key
            )
                lww_elements.value as value,
                events.content_type as content_type
            FROM
                events
            INNER JOIN
                lww_elements
            ON
                events.id = lww_elements.event_id
            INNER JOIN
                event_links
            ON
                events.id = event_links.event_id
            WHERE
                event_links.subject_system_key_type = $1
            AND
                event_links.subject_system_key = $2
            AND
                event_links.subject_process = $3
            AND
                event_links.subject_logical_clock = $4
            ORDER BY
                events.system_key_type,
                events.system_key,
                lww_elements.unix_milliseconds
            DESC
        )
        SELECT
            COUNT(*)
        FROM
            latest_values
        WHERE
            latest_values.value = $5
        AND
            ($6 IS NULL OR latest_values.content_type = $6)
    ";

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let count = ::sqlx::query_scalar::<_, i64>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(value)
        .bind(from_type_query)
        .fetch_one(&mut *transaction)
        .await?;

    Ok(u64::try_from(count)?)
}

pub(crate) async fn count_lww_element_references_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    bytes: &::std::vec::Vec<u8>,
    value: &::std::vec::Vec<u8>,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    let query = "
        WITH latest_values AS (
            SELECT DISTINCT ON (
                events.system_key_type,
                events.system_key
            )
                lww_elements.value as value,
                events.content_type as content_type
            FROM
                events
            INNER JOIN
                lww_elements
            ON
                events.id = lww_elements.event_id
            INNER JOIN
                event_references_bytes
            ON
                events.id = event_references_bytes.event_id
            WHERE
                event_references_bytes.subject_bytes = $1
            ORDER BY
                events.system_key_type,
                events.system_key,
                lww_elements.unix_milliseconds
            DESC
        )
        SELECT
            COUNT(*)
        FROM
            latest_values
        WHERE
            latest_values.value = $2
        AND
            ($3 IS NULL OR latest_values.content_type = $3)
    ";

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let count = ::sqlx::query_scalar::<_, i64>(query)
        .bind(bytes)
        .bind(value)
        .bind(from_type_query)
        .fetch_one(&mut *transaction)
        .await?;

    Ok(u64::try_from(count)?)
}

pub(crate) async fn count_lww_element_references(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    reference: &crate::model::reference::Reference,
    value: &::std::vec::Vec<u8>,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    match reference {
        crate::model::reference::Reference::Pointer(pointer) => {
            count_lww_element_references_pointer(
                &mut *transaction,
                pointer.system(),
                pointer.process(),
                *pointer.logical_clock(),
                value,
                from_type,
            )
            .await
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            count_lww_element_references_bytes(
                &mut *transaction,
                bytes,
                value,
                from_type,
            )
            .await
        }
        _ => {
            unimplemented!("count_lww_element_references case not implemented");
        }
    }
}

#[cfg(test)]
pub mod tests {
    #[::sqlx::test]
    async fn test_no_references(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = crate::model::tests::make_test_keypair();
        let process = crate::model::tests::make_test_process();

        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.public.clone(),
        );

        let result = crate::queries::count_lww_element_references::
            count_lww_element_references_pointer(
                &mut transaction,
                &system,
                &process,
                5,
                &vec![],
                &None,
            ).await?;

        transaction.commit().await?;

        assert!(result == 0);

        Ok(())
    }
}
