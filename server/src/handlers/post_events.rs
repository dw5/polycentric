use ::cadence::Counted;
use ::log::warn;
use ::protobuf::Message;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let events = match crate::protocol::Events::parse_from_tokio_bytes(&bytes) {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string(),
                ::warp::http::StatusCode::BAD_REQUEST,
            )));
        }
    };

    let mut transaction = crate::warp_try_err_500!(state.pool.begin().await);

    for event in &events.events {
        let validated_event =
            match crate::model::signed_event::from_proto(event) {
                Ok(x) => x,
                Err(err) => {
                    return Ok(Box::new(::warp::reply::with_status(
                        err.to_string(),
                        ::warp::http::StatusCode::BAD_REQUEST,
                    )));
                }
            };

        crate::warp_try_err_500!(
            crate::ingest::ingest_event(
                &mut transaction,
                &validated_event,
                &state
            )
            .await
        );

        match state.statsd_client.count("events", 1) {
            Ok(_) => {}
            Err(err) => {
                warn!("Unable to log event metric due to: {}", err)
            }
        };
    }

    crate::warp_try_err_500!(transaction.commit().await);

    Ok(Box::new(::warp::reply::with_status(
        "",
        ::warp::http::StatusCode::OK,
    )))
}
